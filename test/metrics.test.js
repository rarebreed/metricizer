/**@flow
 * Tests for cimetrics
 */

import Rx from "rxjs/Rx"
import test from "ava"
import fs from "fs"
import { getTestNGXML, getTriggerType, getFile, calculateResults, getEnv } from "../src/metrics"
import * as R from "ramda"

// ========================================================================
// Setup mocks/spies
// ========================================================================

const workspace = "/tmp/workspace"
const jobName = "rhsm-rhel-7.5-AllDistros-Tier1Tests"
const fakeDirs = `${jobName}/PLATFORM/RedHatEnterpriseLinux7-Server-x86_64/label/rhsm/test-output`
const fullFakePath = `${workspace}/${fakeDirs}`

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

// ========================================================================
// Begin tests
// ========================================================================

test(`{
    "description": "Tests that getTestNGXML works in mocked jenkins environment",
    "type" : "unit"
}`, t => {
    t.plan(1)
    installMockXML()
    setMockJenkinsEnv()
    let {tier, path } = getTestNGXML({distroMajor: 7, variant: "Server", arch: "x86_64"})
    t.is(path, fullFakePath)
    unsetMockJenkinsEnv()
})


test(`{
    "description": "Tests that we can get the trigger type for a job",
    "type": "integration"
}`, t => {
    let exampleJob = "https://rhsm-jenkins-rhel7.rhev-ci-vms.eng.rdu2.redhat.com/view/QE-RHEL7.5/job/rhsm-rhel-7.5-AllDistros-Tier1Tests/13/api/json?pretty=true"
    let trigger$ = getTriggerType(exampleJob, "334c628e5e5df90ae0fabb77db275c54")
    return trigger$.map(i => {
        if (i.length == 0)
            t.fail("Expected at least one trigger by CI")
        let triggers = R.takeWhile((t => t.value == "Triggered by CI message"), i)
        if (triggers)
            t.pass("At least one cause from Trigger by CI message")
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
            console.log(n.value.total)
            console.log(n.value.props)
            t.pass()
        })
})

test(`{
    "description": "Tests the environment variables through getEnv()",
    "type": "unit"
}`, t => {
    setMockJenkinsEnv()
    t.is(getEnv("WORKSPACE"), workspace)
    t.is(getEnv("JOB_URL"), "/path/to/jenkins/job/url")
})