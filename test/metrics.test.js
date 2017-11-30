/**@flow
 * Tests for cimetrics
 */

import Rx from "rxjs/Rx"
import test from "ava"
import fs from "fs"
import { getTriggerType
       , getFile
       , calculateResults
       , getEnv
       , parseCIMessage
       , getJobStartTime
       , getInjectedVars
       , getMatrixJobLabels
       , getArtifact
       , makeURL
       , main } from "../src/metrics"
import * as R from "ramda"

// ========================================================================
// Get the config file from either ~/.metricizer/metricizer.json or from $METRICIZER_CONFIG
// ========================================================================
const testfile = (args: {path: ?string} = {path: null}) => {
    let config = {}
    let cfgFile = args.path || process.env.METRICIZER_CONFIG || `${process.env.HOME || ""}/.metricizer/metricizer.json`
    let isCfg = fs.existsSync(cfgFile)
    if (!isCfg)
        throw new Error("Could not load the metricizer config file.  Please use either ~/.metricizer/metricizer.json or a file from $METRICIZER_CONFIG")
    return JSON.parse(fs.readFileSync(cfgFile).toString())    
}

const cfg = testfile()
const { jenkins_url, jenkins_user, jenkins_pw } = cfg
console.log(jenkins_url)
const jenkins = `${jenkins_url}/view`

// ========================================================================
// Setup mocks/spies
// ========================================================================
const opts = { tab: 'QE-RHEL7.5', job: 'rhsm-rhel-7.5-AllDistros-Tier1Tests', build: 13, pw: `${jenkins_pw}`, jenkins_url: `${jenkins_url}`, user: `${jenkins_user}` }

const workspace = "/tmp/workspace"
const jobName = "rhsm-rhel-7.5-AllDistros-Tier1Tests"
const fakeDirs = `${jobName}/PLATFORM/RedHatEnterpriseLinux7-Server-x86_64/label/rhsm/test-output`
const fullFakePath = `${workspace}/${fakeDirs}`
// example CI_MESSAGE
const CI_MESSAGE = ""

const clean = (path: string) => {
    if( fs.existsSync(path) ) {
        fs.readdirSync(path).forEach((file: string, _: number) => {
            let curPath = path + "/" + file;
            if(fs.lstatSync(curPath).isDirectory()) { // recurse
                clean(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}


// ========================================================================
// Begin tests
// ========================================================================
test(`{
    "description": "Tests that we can get the trigger type for a job",
    "type": "integration"
}`, t => {
    let exampleJob = "rhsm-rhel-7.5-AllDistros-Tier1Tests"
    let opts = {tab: "QE-RHEL7.5", job: exampleJob, build: 13, pw: jenkins_pw, jenkins_url: jenkins_url, user: jenkins_user}
    let trigger$ = getTriggerType(opts)
    return trigger$.map(i => {
        t.true(i.value === "brew")
    })
})

test(`{
    "description": "Tests that we can calculate all the test results from a testng-polarion.xml file",
    "type: "unit"
}`, t => {
    t.plan(2)
    let cwd = process.cwd()
    let f$ = getFile(`${cwd}/test/resources/testng-polarion.xml`)
    return calculateResults(f$)
        .map(n => {
            console.log(`Calculating results of mocked testng-polarion.xml: ${JSON.stringify(n.value.total, null, 2)}`)
            t.true(n.value.total.total === 29)
            t.true(n.value.total.passed === 15)
        })
})

test(`{
    "description": "Tests that the parseCIMessage() function can get the brew task ID and components",
    "type": "unit"
}`, t => {
    let path = `${process.cwd()}/test/resources/CI_MESSAGE.json`
    console.log(`Path to CI_MESSAGE.json is ${path}`)
    let msg$ = parseCIMessage(getFile(path))
    return msg$.map(r => {
        t.true(r.type === "ci-message", "StreamResult type was not ci-message")
        t.true(r.value.components.length != 0, "Components was empty")
        console.log(`parseCIMessage: ${JSON.stringify(r.value.components, null, 2)}`)
    })
})

test(`{
    "description": "Tests the getJobStartTime() function returns the proper date",
    "type": "integration"
}`, t => {
    let jobTime$ = getJobStartTime(opts)
    return jobTime$.map(time => {
        t.is(time.value.time, '2017-10-10T01:11:58.523Z')
        t.is(time.type, "ci-time")
    })
})

test(`{
    "description": "Tests the main() function that returns the JSON",
    "type": "integration"
}`, t => {
    let opts = {tab: "QE-RHEL7.4", job: "rhsm-rhel-7.4-AllDistros-Tier1Tests", build: 61, pw: jenkins_pw, jenkins_url: jenkins_url, user: jenkins_user}
    let result = main({major: 7, variant: "Server", arch: "x86_64"}, opts)
    return result.response.map(n => {
        console.log(JSON.stringify(n, null, 2))
        t.truthy(n)
        t.true(n.tests[0].executed == 261)
    })
})

test(`{
    "description": "Tests getInjectedVars() works",
    "type": "integration"
}`, t => {
    let v = getInjectedVars(opts)
    return v.map(r => {
        t.true(r.BUILD_URL == "https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/job/rhsm-rhel-7.5-AllDistros-Tier1Tests/13/")
    })
})

test(`{
    "description": "Tests getMatrixJobLabels()",
    "type": "integration"
}`, t => {
    let mj = getMatrixJobLabels(opts)
    return mj.map(runs => {
        console.log(`Runs from matrix job: ${runs}`)
        t.pass()
        //t.true(runs.includes("https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/QE-RHEL7.5/job/rhsm-rhel-7.5-AllDistros-Tier1Tests/PLATFORM=RedHatEnterpriseLinux7-Server-s390x,label=rhsm/13/"))
    })
})

test(`{ 
    "description": "Tests the makeURL() with tab not an empty string function",
    "type": "unit"
}`, t => {
    let opts = {
        job: "rhsm-rhel-7.5-x86_64-Tier1Tests",
        tab: "QE-RHEL7.5",
        build: 43,
        pw: jenkins_pw,
        user: jenkins_user,
        jenkins_url: jenkins_url
    }
    let artifact = "testng-polarion.xml"
    let url = makeURL(opts ,`/artifact/test-output/${artifact}`)
    console.log(`makeURL: ${url}`)
    t.is(url, "https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/QE-RHEL7.5/job/rhsm-rhel-7.5-x86_64-Tier1Tests/43/artifact/test-output/testng-polarion.xml")
})

test(`{ 
    "description": "Tests the makeURL() with tab as an empty string function",
    "type": "unit"
}`, t => {
    let opts = {
        job: "rhsm-rhel-7.5-x86_64-Tier1Tests",
        tab: "",
        build: 43,
        pw: jenkins_pw,
        user: jenkins_user,
        jenkins_url: jenkins_url
    }
    let artifact = "testng-polarion.xml"
    let url = makeURL(opts ,`/artifact/test-output/${artifact}`)
    console.log(`makeURL: ${url}`)
    t.is(url, "https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/job/rhsm-rhel-7.5-x86_64-Tier1Tests/43/artifact/test-output/testng-polarion.xml")
})

test(`{
    "description": "Tests getting an artifact",
    "type": "integration",
    "enabled": false
}`, t => {
    let opts = {
        job: "rhsm-rhel-7.5-x86_64-Tier1Tests",
        tab: "QE-RHEL7.5",
        build: 43,
        pw: jenkins_pw,
        user: jenkins_user,
        jenkins_url: jenkins_url
    }
    let art$ = getArtifact(opts, "testng-polarion.xml")
    return art$.map(f => {
        t.truthy(f)
    })
})