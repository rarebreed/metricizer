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
import type { URLOpts
            , StreamResult
            , TestValue
            , MetricsTest
            , Distro
            , Variant
            , Arch
            , StreamData
            , CIMessageResult
            , PlatformLabel
            } from "metricizer"

const jenkins = `https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view`

function getEnv(name: string): ?string {
    let s: ?string =  process.env[name]
    return s
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
 * Given the path to a xml file, convert it to a string
 * 
 * @param {*} path 
 */
function getFile(path: string) {
    let readFile$ = Rx.Observable.bindNodeCallback(fs.readFile)
    let bf$ =  readFile$(path, "utf8").map(b => b.toString())
    return bf$
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
        .catch(err => {  // If we blow up parsing, use a default
            console.warn("Using a DEFAULT CI_MESSAGE.json!")
            let cwd = `${process.cwd()}/test/resources/CI_MESSAGE.json`
            let default$ = getFile(cwd)
            return parseCIMessage(default$)
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
 * Gets the injected Vars for a particular job (eg BUILD_URL, WORKSPACE)
 * 
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
        .do(r => console.debug(JSON.stringify(r, null, 2)))
}

const getPlatformFromLabel = (label: string) => {
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

/**
 * Retrieves all the labels for a matrix job and returns as a Map of variant to Map of arch to URI path
 * 
 * @param {*} opts 
 */
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

const dataCheck = (res: {type: string, value: any}, data: StreamData) => {
    // FIXME: This switch feels ugly. But I need to know the res.type in order to merge data together
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
    return data
}

/**
 * This is the main function which actually calculates the JSON to be sent to the CI Metrics data
 * 
 * @param {*} opt
 */
function main( opts: Distro, urlOpts: URLOpts): Rx.AsyncSubject<string> {
    // Helper function to get artifacts based on the opts Distro by looking up the matrix job label
    const artifactStream = (lbl$: Rx.Observable<PlatformLabel>, artifact: string, fn: (Rx.Observable<any>) => Rx.Observable<any>) => {
        console.log(`Getting artifact for ${artifact}`)
        return labels$.concatMap(lbls => {
            let artOpts = Object.assign({}, urlOpts)  // copy the object
            artOpts.job = getJobFromLabel(lbls.get(opts.variant).get(opts.arch)).join("/")
            let art$ = getArtifact(artOpts, artifact)
            return fn(art$)
        })
    }
    // Assemble our streams  
    let trigger$ = getTriggerType(urlOpts)
    let jobTime$ = getJobStartTime(urlOpts)
    let envVars$ = getInjectedVars(urlOpts).map(v => Object.assign({type: "env-vars", value: v}))

    // Get the matrix job labels so we can calculate which artifacts (testng-polarion.xml and CI_MESSAGE.json) to download
    let labels$ = getMatrixJobLabels(urlOpts)
    let testResults$ = artifactStream(labels$, "testng-polarion.xml", calculateResults)
    let ciMessage$ = artifactStream(labels$, "CI_MESSAGE.json", parseCIMessage)

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

    // This is our return object. We use it to pass the calculated JSON data back out.  GraphQL doesn't
    // support Observables, so we "push" the data to the subject, and then we can convert to a Promise
    let response$ = new Rx.AsyncSubject({})

    // This is where all the action happens.  We merge all our streams together.  Most of the logic here
    // is in the reduce.  When the streams are merged, we accumulate the events in the stream into the data
    // object.  Since we use reduce instead of scan, this means each of the merged streams must complete
    // (ie, they must emit the complete event)
    let sub = Rx.Observable.merge(trigger$, testResults$, ciMessage$, jobTime$, envVars$)
        .reduce((acc, res) => dataCheck(res, acc), data)
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

                //let json = JSON.stringify(data)
                response$.next(data)
                response$.complete()
                // TODO: Hook this into pouchdb and save this off
                //fs.writeFileSync(`/tmp/CI_METRICS.json`, json)
            },
            error: err => console.error(err),
            complete: () => console.debug("main() sent a completion event")
        })

    return {
        subscription: sub,
        response: response$
    }
}


module.exports = {
    getEnv: getEnv,
    calculateResults: calculateResults,
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
