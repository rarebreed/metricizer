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

type Arch = "aarch64" | "x8664" | "x86_64" | "s390" | "ppc64" | "ppc64le"

type MetricsTest = { executor: "beaker" | "CI-OSP"
                   , arch: Arch
                   , executed: number
                   , failed: number
                   , passed: number 
                   }

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

/**
 * Given the major version, variant and arch types, it will look for a job in the $WORKSPACE in order to get the absolute path to the testng-polarion.xml file
 * 
 * @param {*} opts 
 */
function getTestNGXML(opts: {distroMajor: number, variant: Variant, arch: Arch}) {
    let {distroMajor, variant, arch} = opts
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
        fullPath = `${workspace}/${jobName}/PLATFORM/RedHatEnterpriseLinux${distroMajor}-${variant}-${arch}/label/rhsm/test-output`
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
    type: "ci-message" | "trigger" | "test-results",
    value: T
}

/**
 * Given a stream representing a testng-polarion.xml file, convert it to a json equivalent and tally up what's needed
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
 * @param {*} job (eg https://jenkins.server.com/job/rhsm-rhel-7.5-x86_64-Tier1Tests/42/) 
 * @param {*} pw 
 */
function getTriggerType(job: string, pw: string): Rx.Observable<StreamResult<number>> {
    let req = ur.get(`${job}/api/json?pretty=true`)
        .header("Accept", "application/json")
        .auth("ops-qe-jenkins-ci-automation", pw, true)
        .strictSSL(false)
    let req$ = Rx.Observable.bindCallback(req.end)
    // Filter out actions that don't have a cause field, then for each action with a cause, check the cause object for shortDescription
    // If the length of this filter is greater than 1, then this job was triggered by 
    return req$().map(j => {
        let causes = j.body.actions.filter(i => i.causes != null)
        return causes
            .filter(i => i.shortDescription != "Triggered by CI message")
            .map(res => {
                return {
                    value: res.shortDescription,
                    type: "trigger"
                }
            })
        })
}

import * as R from "ramda"

function testTriggerType() {
    let exampleJob = "https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/QE-RHEL7.5/job/rhsm-rhel-7.5-AllDistros-Tier1Tests/13/api/json?pretty=true"
    let trigger$ = getTriggerType(exampleJob, "334c628e5e5df90ae0fabb77db275c54")
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
 * @param {*} msg 
 */
function parseCIMessage(msg: Path): Rx.Observable<StreamResult<CIMessageResult>> {
    let file$ = getFile(msg)
    file$.map(c => {
        // TODO: Parse to get needed fields
        return {
            type: "ci-message",
            value: {
                brewTaskID: "",
                version: ""
            }
        }
    })
}

function main() {
    let testngPath = getTestNGXML({distroMajor: 7, variant: "Server", arch: "x8664"})
    // Assemble our streams
    let ciMessage$ = parseCIMessage("CI_MESSAGE.json")  // FIXME: Need path to CI_MESSAGE.json
    let trigger$ = getTriggerType("/path/to/job", "")   // FIXME: Need path to job and password
    let testResults$ = calculateResults(getFile(testngPath.path))

    Rx.Observable.merge(ciMessage$, trigger$, testResults$)
        .subscribe({
            next: res => {
                switch(res.type) {
                    case "trigger":
                        
                        break
                }
            }
        })

    let metricsData = {

    }
}

module.exports = {
    getEnv: getEnv,
    calculateResults: calculateResults,
    getTestNGXML: getTestNGXML,
    getTriggerType: getTriggerType,
    getFile: getFile
};
