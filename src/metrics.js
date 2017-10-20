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
function getFile(path: string): Rx.Observable<string> {
    let readFile$ = Rx.Observable.bindNodeCallback(fs.readFile)
    return readFile$(path, "utf8").map(b => b.toString())
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
    type: "ci-message" | "trigger" | "test-results" | "ci-time",
    value: T
}

type URLOpts = {
    job: string,
    build: number,
    pw: string, 
    tab: string
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
function parseCIMessage(msg: Path): Rx.Observable<StreamResult<CIMessageResult>> {
    let file$ = getFile(msg)
    return file$.map(c => {
        let cimsg = JSON.parse(c)
        let allowed = ["i386", "x86_64", "ppc64", "ppc64le", "aarch64", "s390", "s390x"]
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
 * 
 * @param {*} opt
 */
function main( opts: Distro = {major: 7, variant: "Server", arch: "x8664"}
             , urlOpts: URLOpts
             ) {
    let testngPath = getTestNGXML(opts) // FIXME
    let workspace = getEnv("WORKSPACE")
    if (!workspace) {
        throw new Error("Could not get WORKSPACE")
    }
    // Assemble our streams
    let ciMessage$ = parseCIMessage(`${workspace}/CI_MESSAGE.json`)  // FIXME: Need path to CI_MESSAGE.json
    ciMessage$.do(r => console.log(`ciMessage$: ${JSON.stringify(r, null, 2)}`))
    let trigger$ = getTriggerType(urlOpts)
    let testResults$ = calculateResults(getFile(`${testngPath.path}/testng-polarion.xml`))
    let jobTime$ = getJobStartTime(urlOpts)
    let data = {
        trigger: "",
        testResults: [],
        brewTaskID: "",
        components: [],
        createTime: "",
        epoch: 0
    }

    Rx.Observable.merge(trigger$, testResults$, ciMessage$, jobTime$)
        .reduce((acc, res) => {
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
                default:
                    console.error("Unknown type")
            }
            return acc
        }, data)
        //.do(res => console.log(`Accumulated = ${JSON.stringify(res, null, 2)}`))
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
                    jenkins_job_url: getEnv("JOB_URL") || "",
                    jenkins_build_url: getEnv("BUILD_URL") || "",
                    logstash_url: "",
                    CI_tier: testngPath.tier,
                    base_distro: `RHEL ${opts.major}.${opts.minor || ""}`,
                    brew_task_id: res.brewTaskID,
                    compose_id: "",
                    create_time: res.createTime, 
                    completion_time: testrunTime.toISOString(), 
                    CI_infra_failure: "",
                    CI_infra_failure_desc: "",
                    job_name: getEnv("JOB_NAME") || "",
                    build_type: res.trigger === "brew" ? "official" : "internal",
                    team: "rhsm-qe",
                    recipients: ["jsefler", "jmolet", "reddaken", "shwetha", "stoner", "jstavel"],
                    artifact: ""
                }
                console.log(`data = ${JSON.stringify(data, null, 2)}`)

                // TODO: Send this JSON back as a Promise for the resolver
                let workspace = getEnv("WORKSPACE") || "/tmp"
                fs.writeFileSync(`${workspace}/${urlOpts.job}/CI_METRICS.json`, JSON.stringify(data))
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
    parseCIMessage: parseCIMessage
};
