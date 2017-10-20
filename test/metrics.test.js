/**@flow
 * Tests for cimetrics
 */

import Rx from "rxjs/Rx"
import test from "ava"
import fs from "fs"
import { getTestNGXML
       , getTriggerType
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
// Setup mocks/spies
// ========================================================================
const opts = { tab: 'QE-RHEL7.5', job: 'rhsm-rhel-7.5-AllDistros-Tier1Tests', build: 13, pw: '334c628e5e5df90ae0fabb77db275c54' }

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

/**
 * Creates a directory emulating the rhsm-rhel-AllDistros-Tier1.
 * 
 * Synchronous
 */
const mockAllDistrosTier1Job = (): { mockDirResult: boolean, mockDirValue: string } => {
    
    let dirs = fakeDirs.split("/")
    let start = `${workspace}/${jobName}`
    if (fs.existsSync(`${workspace}`))
        clean(`${workspace}`)
    fs.mkdirSync(workspace)

    dirs.reduce((acc: string, d: string) => {
        acc = `${acc}/${d}`
        console.log(acc)
        fs.mkdirSync(acc)
        return acc
    }, workspace)

    let path = `${workspace}/${fakeDirs}`
    console.log(path)
    return { 
        mockDirResult: fs.existsSync(path),
        mockDirValue: path
    }
}

// Constants for where the mock directory is
const { mockDirResult, mockDirValue } = mockAllDistrosTier1Job()

/**
 * Installs the example testng-polarion.xml file to path from mockAllDistros.  
 * 
 * Synchronous
 */
const installMockXML = (): boolean => {
    let cwd = process.cwd()
    let xml = `${cwd}/test/resources/testng-polarion.xml`
    fs.copyFileSync(xml, `${mockDirValue}/testng-polarion.xml`)  // FIXME: flow says this is an error, but it isn't
    return fs.existsSync(`${mockDirValue}/testng-polarion.xml`)
}

//const mockXML = installMockXML()

const uninstallMockXML = (): boolean => {
    let cwd = process.cwd()
    let xml = `${cwd}/test/resources/testng-polarion.xml`
    console.log("Uninstalling testng-polarion.xml")
    fs.unlink(`${mockDirValue}/testng-polarion.xml`)  // FIXME: flow says this is an error, but it isn't
    return !fs.existsSync(`${mockDirValue}/testng-polarion.xml`)
}

const installMsgJSON = (): boolean => {
    let cwd = process.cwd()
    let json = `${cwd}/test/resources/CI_MESSAGE.json`
    fs.copyFileSync(json, `${workspace}/CI_MESSAGE.json`)
    return fs.existsSync(`${workspace}/CI_MESSAGE.json`)
}

const uninstallMsgJSON = (): boolean => {
    let cwd = process.cwd()
    let json = `${cwd}/test/resources/CI_MESSAGE.json`
    console.log("Uninstalling CI_MESSAGE.json")
    fs.unlink(`${workspace}/CI_MESSAGE.json`)
    return !fs.existsSync(`${workspace}/CI_MESSAGE.json`)
}


/**
 * Creates the necessary Jenkins environment variables
 */
const setMockJenkinsEnv = () => {
    process.env["WORKSPACE"] = workspace
    process.env["JOB_URL"] = "/path/to/jenkins/job/url"
    process.env["BUILD_URL"] = "/path/to/jenkins/job/url/44"
    process.env["JOB_NAME"] = jobName
}

const unsetMockJenkinsEnv = () => {
    let keys = ["WORKSPACE", "JOB_URL", "BUILD_URL", "JOB_NAME"]
    keys.forEach(k => process.env[k] = undefined)
}

test.before("Sets up mock environment", t => {
    installMockXML()
    installMsgJSON()
    setMockJenkinsEnv()
})

/*
test.after("Uninstalls mock environment", t => {
    //uninstallMockXML()
    //uninstallMsgJSON()
    unsetMockJenkinsEnv()
})
*/

// ========================================================================
// Begin tests
// ========================================================================

test(`{
    "description": "Tests the getEnv() function",
    "type": "unit"
}`, t => {
    let ws = getEnv("WORKSPACE")
    let ju = getEnv("JOB_URL")
    let bu = getEnv("BUILD_URL")
    let jn = getEnv("JOB_NAME")
    t.true(ws === "/tmp/workspace")
})

test(`{
    "description": "Tests that getTestNGXML works in mocked jenkins environment",
    "type" : "unit"
}`, t => {
    t.plan(1)
    let {tier, path } = getTestNGXML({major: 7, variant: "Server", arch: "x86_64"})
    t.is(path, fullFakePath)
})


test(`{
    "description": "Tests that we can get the trigger type for a job",
    "type": "integration"
}`, t => {
    let exampleJob = "rhsm-rhel-7.5-AllDistros-Tier1Tests"
    let opts = {tab: "QE-RHEL7.5", job: exampleJob, build: 13, pw: "334c628e5e5df90ae0fabb77db275c54"}
    let trigger$ = getTriggerType(opts)
    return trigger$.map(i => {
        t.true(i.value === "brew")
    })
})

test(`{
    "description": "Tests that we can calculate all the test results from a testng-polarion.xml file",
    "type: "unit"
}`, t => {
    t.plan(1)
    let cwd = process.cwd()
    let f$ = getFile(`${cwd}/test/resources/testng-polarion.xml`)
    return calculateResults(f$)
        .map(n => {
            t.pass()
        })
})

test(`{
    "description": "Tests the environment variables through getEnv()",
    "type": "unit"
}`, t => {
    t.is(getEnv("WORKSPACE"), workspace)
    t.is(getEnv("JOB_URL"), "/path/to/jenkins/job/url")
})

test(`{
    "description": "Tests that the parseCIMessage() function can get the brew task ID and components",
    "type": "unit"
}`, t => {
    let path = `${process.cwd()}/test/resources/CI_MESSAGE.json`
    console.log(`Path to CI_MESSAGE.json is ${path}`)
    let msg$ = parseCIMessage(path)
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
    let opts = {tab: "QE-RHEL7.5", job: "rhsm-rhel-7.5-AllDistros-Tier1Tests", build: 13, pw: "334c628e5e5df90ae0fabb77db275c54"}
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
    let opts = {tab: "QE-RHEL7.5", job: "rhsm-rhel-7.5-AllDistros-Tier1Tests", build: 13, pw: "334c628e5e5df90ae0fabb77db275c54"}
    main({major: 7, variant: "Server", arch: "x86_64"}, opts)
    t.pass()
})

test(`{
    "description": "Tests getInjectedVars() works",
    "type": "integration"
}`, t => {
    let opts = { tab: 'QE-RHEL7.5', job: 'rhsm-rhel-7.5-AllDistros-Tier1Tests', build: 13, pw: '334c628e5e5df90ae0fabb77db275c54' }
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
    "description": "Tests the makeURL() function",
    "type": "unit"
}`, t => {
    let opts = {
        job: "rhsm-rhel-7.5-x86_64-Tier1Tests",
        tab: "QE-RHEL7.5",
        build: 43,
        pw: "334c628e5e5df90ae0fabb77db275c54"
    }
    let artifact = "testng-polarion.xml"
    let url = makeURL(opts ,`/artifact/test-output/${artifact}`)
    console.log(`makeURL: ${url}`)
    t.is(url, "https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/QE-RHEL7.5/job/rhsm-rhel-7.5-x86_64-Tier1Tests/43/artifact/test-output/testng-polarion.xml")
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
        pw: "334c628e5e5df90ae0fabb77db275c54"
    }
    let art$ = getArtifact(opts, "testng-polarion.xml")
    return art$.map(f => {
        t.truthy(f)
    })
})