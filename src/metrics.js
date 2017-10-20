/**@flow 
 * This module will get the information needed to create the JSON data required for the CI Metrics
 * 
 * Some of this information will come from environment variables, and some of it will come from either the 
 * polarion-testng.xml file, or from the CI_MESSAGE.json.
 */
const Rx = require("rxjs/Rx")
const fs = require("fs")
const x2j = require("xml2js")
const ur = require("unirest")
import type { URLOpts } from "metricizer"

const jenkins = `https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view`

function getEnv(name: string): ?string {
    let s: ?string =  process.env[name]
    return s
}

// Correspons to schema.Arch
type Arch = "i386" | "aarch64" | "x8664" | "x86_64" | "s390" | "ppc64" | "ppc64le"

// Corresponds to schema.MetricsTest
type MetricsTest = { executor: "beaker" | "CI-OSP"
                   , arch: Arch
                   , executed: number
                   , failed: number
                   , passed: number 
                   }

/**
 * Corresponds to schema.Metrics
 * 
 * This type represents what is needed by the CI Metrics JSON.
 */
type Metrics = { component: string // "subscription-manager-${SUBMAN_VERSION}"  TODO: How do we get the version of subscription-manager we are testing?  
                                   // From CI_MESSAGE I suppose that information is in the brew info?
               , trigger: string   // TODO: Can get this from curl -u ops-qe-jenkins-ci-automation:334c628e5e5df90ae0fabb77db275c54 -k <BUILD_URL> and look for [actions] -> [causes] -> shortDescription 
               , tests: MetricsTest[]
               , jenkins_job_url: string   // "${JENKINS_URL}"
               , jenkins_build_url: string // "${BUILD_URL}"
               , logstash_url: string      // TODO: Ask boaz what this url is
               , CI_tier: number           // FIXME: Do we have a var that indicates this?  Our job name itself tells what tier the test is for
               , base_distro: string       // "RHEL 7.2+updates",  TODO: Should be from DISTRO var unless they want a specific format
               , brew_task_id: number      // TODO: need to parse the CI_MESSAGE text and see if it is in there
               , compose_id: string        // Is there a way to get this?  Seems to only for use case 3 (eg nightly testing)
               , create_time: string       // TODO: This should be part of the polarion-testng.xml.  Not sure why they need this.  Need to extract from xml
               , completion_time: string   // TODO: Same as above
               , CI_infra_failure: string  // FIXME: Clarify what this is for
               , CI_infra_failure_desc: string // FIXME:  see above
               , job_name: string          // "${JOB_NAME}"
               , build_type: "official" | "internal"
               , team: string
               , recipients: string[]      // ["jsefler", "jmolet", "reddaken", "shwetha", "jstavel"]
               , artifact: string         // TODO: Not sure what artifact to put here.  The polarion results?  the testng.xml?
               }

type Variant = "Server" | "Workstation" | "Client" | "ComputeNode"

type Distro = {
    major: number, 
    minor?: number,
    variant: Variant,
    arch: Arch
}

const getJenkinsAPI = (url: string, pw: string) => {
    let req = ur.get(url)
        .header("Accept", "application/json")
        .auth("ops-qe-jenkins-ci-automation", pw, true)
        .strictSSL(false)
    let req$ = Rx.Observable.bindCallback(req.end)
    return req$
}

const makeURL = (opts: URLOpts, api: string) => {
    let { job, build, pw, tab } = opts
    return `${jenkins}/${tab}/job/${job}/${build}${api}`
}

const getArtifact = (opts: URLOpts, artifact: string) => {
    let url = makeURL(opts ,`/artifact/test-output/${artifact}`)
    console.log(`Getting artifact from ${url}`)
    let req$ = getJenkinsAPI(url, opts.pw)
    return req$().map(resp => {
        return resp.body
    })
}

/**
 * Given the major version, variant and arch types, it will look for a job in the $WORKSPACE in order to get the absolute path to the 
 * testng-polarion.xml file
 * 
 * This function is used to find the path to the test-output folder for a given AllDistros type job.  This function is useful 
 * because it allows other functions to get the path the testng-polarion.xml file that is created by a run of this job
 * 
 * @param {*} opts 
 */
function getTestNGXML(opts: Distro) {
    let {major, variant, arch} = opts
    let workspace = getEnv("WORKSPACE")
    let jobName = getEnv("JOB_NAME")
    let fullPath = ""
    let re = /AllDistros.*Tier(\d)/
    if (workspace == null || jobName == null) {
        throw new Error("Could not get path for the XML result")
    }

    let matched = re.exec(jobName)
    let tier
    if (matched != null) {
        fullPath = `${workspace}/${jobName}/PLATFORM/RedHatEnterpriseLinux${major}-${variant}-${arch}/label/rhsm/test-output`
        tier = matched[1]
    }
    else {
        fullPath = `${workspace}/${jobName}/test-output`
        tier = 0
    }

    return {
        path: fullPath,
        tier: tier
    }
}

/**
 * Given the path to a xml file, convert it to a string
 * 
 * @param {*} path 
 */
function getFile(path: string) {
    let readFile$ = Rx.Observable.bindNodeCallback(fs.readFile)
    let bf$ =  readFile$(path, "utf8").map(b => b.toString())
    return bf$
}

type Calculated = {
    total: number, 
    failures: number, 
    errors: number, 
    passed: number, 
    time: number
}

type Property = {
    name: string,
    value: string
}

type TestValue = {
    total: Calculated,
    props: any
}

type StreamResult<T> = {
    type: "ci-message" | "trigger" | "test-results" | "ci-time" | "env-vars",
    value: T
}



/**
 * Given a stream representing a testng-polarion.xml file, convert it to a json equivalent and tally up what's needed
 * 
 * NOTE: This function is used to calculate the value for "tests" in the JSON for the metrics data
 * 
 * @param {*} xml$ 
 */
function calculateResults( xml$: Rx.Observable<string> )
                         : Rx.Observable<StreamResult<TestValue>> {
    // xml$ contains the XML as a string.  concat the result of this with x2j.parseString to get the JSON version
    return xml$.concatMap(s => {
            let r$ = Rx.Observable.bindCallback(x2j.parseString)
            return r$(s)
        })
        .map(obj => {
            // obj[1] contains the testsuite object.  
            let suites = obj[1].testsuites
            let props = suites.properties

            // Mutating the accumulation here which is kind of gross, but also more efficient than creating a new object
            // FIXME: Look into immutable Map and converting to object at the end
            // FIXME: Give the suites, acc, and n variables a type
            let total = suites.testsuite.reduce((acc, n) => {
                let s = n.$
                acc.total += Number(s.tests)
                acc.failures += Number(s.failures)
                acc.errors += Number(s.errors)
                acc.time += Number(s.time)

                let passed = Number(s.tests) - (Number(s.failures) + Number(s.errors) + Number(s.skipped))
                acc.passed += passed
                return acc
            }, { 
                total: 0,
                failures: 0,
                errors: 0,
                passed: 0,
                time: 0, 
            })

            return {
                type: "test-results",
                value: {
                    total: total,
                    props: props
                }
            }
        })
}

/**
 * Makes a request to a job url to get the API details
 * 
 * NOTE: This function will be used to get the value for the "trigger" field in the JSON to be sent
 * 
 * @param {*} job (eg https://jenkins.server.com/job/rhsm-rhel-7.5-x86_64-Tier1Tests/42/) 
 * @param {*} pw 
 */
function getTriggerType(opts: URLOpts): Rx.Observable<StreamResult<number>> {
    let { tab, job, build, pw } = opts
    let url = `https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/${tab}/job/${job}/${build}`
    let req = ur.get(`${url}/api/json?pretty=true`)
        .header("Accept", "application/json")
        .auth("ops-qe-jenkins-ci-automation", pw, true)
        .strictSSL(false)
    let req$ = Rx.Observable.bindCallback(req.end)
    // Filter out actions that don't have a cause field, then for each action with a cause, check the cause object for shortDescription
    // If the length of this filter is greater than 1, then this job was triggered by 
    return req$().map(j => {
        let causes = j.body.actions.filter(i => i.causes != null)
        // FIXME: what if causes is empty?
        let triggers = causes.map(c => c.causes[0])
            .map(res => {
                let trigger = "manual"
                if (res.shortDescription.includes("CI message"))
                    trigger = "brew"
                else if (res.shortDescription.includes("Timer"))
                    trigger = "timer"

                return {
                    value: trigger,
                    type: "trigger"
                }
            })
        return R.head(triggers)
        })
}

import * as R from "ramda"

function testTriggerType() {
    let exampleJob = "rhsm-rhel-7.5-AllDistros-Tier1Tests"
    let opts = { tab: "QE-RHEL7.5", job: exampleJob, build: 13, pw: "334c628e5e5df90ae0fabb77db275c54"}
    let trigger$ = getTriggerType(opts)
    trigger$.subscribe(i => {
        if (i.length == 0) {
            console.error("Expected at least one trigger by CI")
            return
        }
        let triggers = R.takeWhile((t => t.value == "Triggered by CI message"), i)
        if (triggers)
            console.log("At least one cause from Trigger by CI message")
    })
}


type Path = string
type CIMessageResult = {
    brewTaskID: string,
    version: string
}

/**
 * Parses the CI_MESSAGE.json file to get the brew task ID and version we are testing 
 * 
 * NOTE: This function is used to get the data needed by the following fields for the JSON metrics data:
 * - components
 * - brew_task_id
 * 
 * @param {*} msg 
 */
function parseCIMessage(file$: Rx.Observable<string>): Rx.Observable<StreamResult<CIMessageResult>> {
    return file$.map(c => {
        let cimsg = JSON.parse(c)
        let allowed = ["i386", "x86_64", "ppc64", "ppc64le", "aarch64", "s390x"]
        let keys = Reflect.ownKeys(cimsg.rpms).filter(k => allowed.includes(k))
        let result = {
            type: "ci-message",
            value: {
                brewTaskID: cimsg.build.task_id,
                components: []
            }
        }
        if (keys)
            result.value.components = cimsg.rpms[keys[0]]
        return result
    })
}

function getJobStartTime(opts: URLOpts) {
    let { job, build, pw, tab } = opts
    let url = `https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/${tab}/job/${job}/${build}/api/json?tree=timestamp`
    let req = ur.get(url)
        .header("Accept", "application/json")
        .auth("ops-qe-jenkins-ci-automation", pw, true)
        .strictSSL(false)
    let req$ = Rx.Observable.bindCallback(req.end)
    return req$().map(resp => {
        let d = new Date(resp.body.timestamp)
        return {
            type: "ci-time",
            value: {
                epoch: resp.body.timestamp,
                time:  d.toISOString()
            }
        }
    })
}

/**
 * Gets the injected Vars
 * @param {*} opts 
 */
function getInjectedVars(opts: URLOpts): Rx.Observable<{}> {
    let { tab, job, build, pw} = opts
    let url = `https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/${tab}/job/${job}/${build}/injectedEnvVars/export`
    let req = ur.get(url)
        .header("Accept", "application/json")
        .auth("ops-qe-jenkins-ci-automation", pw, true)
        .strictSSL(false)
    let req$ = Rx.Observable.bindCallback(req.end)
    return req$().map(resp => {
            return resp.body.envVars.envVar
        })
        .map(vars => {
            // There shouldn't be any duplicate names, so let's reduce this to an object
            return vars.reduce((acc, n) => {
                let {name, value} = n
                acc[name] = value
                return acc
            }, {})
        })
        //.do(r => console.log(JSON.stringify(r, null, 2)))
}

const getPlatformFromLabel = (label: string) => {
    console.log(`Getting Distro for ${label}`)
    let re = /RedHatEnterpriseLinux(\d)-(\w+)-(\w+),/
    let matched = re.exec(label)
    if (matched != null) {
        let ret: Distro = {
            major: Number(matched[1]),
            variant: matched[2],
            arch: matched[3]
        }
        return ret
    }
    else 
        throw new Error("Could not determine Distro from label")
}

type PlatformLabel = Map<Variant, Map<Arch, string>>

function getMatrixJobLabels(opts: URLOpts): Rx.Observable<PlatformLabel> {
    let { tab, job, build, pw } = opts
    let url = `https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/${tab}/job/${job}/${build}/api/json?tree=runs[number,url]`
    let req$ = getJenkinsAPI(url, pw)
    let d: PlatformLabel = new Map()
    return req$().mergeMap(resp => {
            let runs: {number: number, url: string}[] = resp.body.runs
            return Rx.Observable.of(...runs)
        })
        .filter(run => run.number === build)
        //.do(r => console.log(`In getMatrixJobLabels: ${JSON.stringify(r, null, 2)}`))
        .pluck("url")
        .reduce((acc: PlatformLabel, n: string) => {
            let distro = getPlatformFromLabel(n)
            // ughh more mutation (and if/elses).  But immutable.js still doesn't play nice with flow
            if (distro) {
                if (acc.has(distro.variant)) {
                    let variant = acc.get(distro.variant)
                    if (variant)
                        variant.set(distro.arch, n)
                }
                else {
                    acc.set(distro.variant, new Map())
                    let variant = acc.get(distro.variant)
                    if (variant)
                        variant.set(distro.arch, n)
                }
            }
            return acc
        }, d)
}

const getTierFromJob = (job) => {
    let matched = /Tier.*(\d)/.exec(job)
    if (matched != null)
        return Number(matched[1])
    else
        return 0
}

const getJobFromLabel = (label: string) => {
    let parts = label.substr(8).split("/").slice(4,6)
    if (parts.length !== 2)
        throw new Error("Could not get the 2 sections for the job")
    return parts
}

/**
 * This is the main function which actually calculates the JSON to be sent to the CI Metrics data
 * 
 * @param {*} opt
 */
function main( opts: Distro, urlOpts: URLOpts) {
    // Assemble our streams  
    let trigger$ = getTriggerType(urlOpts)
    let jobTime$ = getJobStartTime(urlOpts)
    let envVars$ = getInjectedVars(urlOpts).map(v => {
        let ret: StreamResult<{}> =  {
            type: "env-vars",
            value: v
        }
        return ret
    })

    let labels$ = getMatrixJobLabels(urlOpts)
    const artifactStream = (artifact: string, fn: (Rx.Observable<any>) => Rx.Observable<any>) => {
        return labels$.concatMap(lbls => {
            let artOpts = Object.assign({}, urlOpts)  // copy the object
            artOpts.job = getJobFromLabel(lbls.get(opts.variant).get(opts.arch)).join("/")
            let art$ = getArtifact(artOpts, "testng-polarion.xml")
            return fn(art$)
        })
    }

    // Get the matrix job labels so we can calculate which artifacts (testng-polarion.xml and CI_MESSAGE.json) to download
    let testResults$ = labels$.concatMap(lbls => {
        let artOpts = Object.assign({}, urlOpts)  // copy the object
        artOpts.job = getJobFromLabel(lbls.get(opts.variant).get(opts.arch)).join("/")
        let testng$ = getArtifact(artOpts, "testng-polarion.xml")
        return calculateResults(testng$)
    })
    let ciMessage$ = labels$.concatMap(lbls => {
        let msgOpts = Object.assign({}, urlOpts)  // copy the object
        msgOpts.job = getJobFromLabel(lbls.get(opts.variant).get(opts.arch)).join("/")
        let cimsg$ = getArtifact(msgOpts, "CI_MESSAGE.jon")
        return parseCIMessage(cimsg$) 
    })

    // This object will accumulate the data from the streams.  Note that we will mutate this value
    // An alternative would be to use an immutable.Map, or to use Object.assign() to create a new obj
    let data = {
        trigger: "",
        testResults: [],
        brewTaskID: "",
        components: [],
        createTime: "",
        epoch: 0,
        envVars: {}
    }

    Rx.Observable.merge(trigger$, testResults$, ciMessage$, jobTime$, envVars$)
        .reduce((acc, res) => {
            // FIXME: This switch feels ugly. But I need to know the res.type and act accordingly
            switch(res.type) {
                case "trigger":
                    data.trigger = res.value
                    break
                case "test-results":
                    data.testResults = res.value
                    break
                case "ci-message":
                    data.brewTaskID = res.value.brewTaskID
                    data.components = res.value.components
                    break
                case "ci-time":
                    data.createTime = res.value.time
                    data.epoch = res.value.epoch
                    break
                case "env-vars":
                    data.envVars = res.value
                    break
                default:
                    console.error("Unknown type")
            }
            return acc
        }, data)
        .do(r => console.log(JSON.stringify(r, null, 2)))
        .subscribe({
            next: res => {
                let tr = res.testResults.total
                let tests = [ { executor: "beaker"
                              , arch: opts.arch
                              , executed: tr.total
                              , failed: tr.failures + tr.errors
                              , passed: tr.passed 
                              } ]
                let testrunTime = new Date(res.epoch + tr.time)

                let data = {
                    component: res.components[0],
                    trigger: res.trigger,
                    tests: tests,
                    jenkins_job_url: res.envVars.JOB_URL || "",
                    jenkins_build_url: res.envVars.BUILD_URL || "",
                    logstash_url: "",
                    CI_tier: getTierFromJob(urlOpts.job),
                    base_distro: `RHEL ${opts.major}.${opts.minor || ""}`,
                    brew_task_id: res.brewTaskID,
                    compose_id: "",
                    create_time: res.createTime, 
                    completion_time: testrunTime.toISOString(), 
                    CI_infra_failure: "",
                    CI_infra_failure_desc: "",
                    job_name: res.envVars.JOB_NAME || "",
                    build_type: res.trigger === "brew" ? "official" : "internal",
                    team: "rhsm-qe",
                    recipients: ["jsefler", "jmolet", "reddaken", "shwetha", "stoner", "jstavel"],
                    artifact: ""
                }
                console.log(`data = ${JSON.stringify(data, null, 2)}`)

                // TODO: Send this JSON back as a Promise for the resolver
                //let workspace = res.envVars.WORKSPACE || "/tmp"
                //fs.writeFileSync(`/tmp/${urlOpts.job}/CI_METRICS.json`, JSON.stringify(data))
                fs.writeFileSync(`/tmp/CI_METRICS.json`, JSON.stringify(data))
            }
        })
}

module.exports = {
    getEnv: getEnv,
    calculateResults: calculateResults,
    getTestNGXML: getTestNGXML,
    getTriggerType: getTriggerType,
    getFile: getFile,
    main: main,
    getJobStartTime: getJobStartTime,
    parseCIMessage: parseCIMessage,
    getInjectedVars: getInjectedVars,
    getMatrixJobLabels: getMatrixJobLabels, 
    getArtifact: getArtifact,
    getJenkinsAPI: getJenkinsAPI,
    makeURL: makeURL
};
