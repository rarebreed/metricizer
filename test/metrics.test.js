/**@flow
 * Tests for cimetrics
 */

import test from "ava"
import fs from "fs"
import { getTestNGXML } from "../src/metrics"

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

// ========================================================================
// Begin tests
// ========================================================================

test("Tests that getTestNGXML works in mocked jenkins environment", t => {
    t.plan(1)
    installMockXML()
    setMockJenkinsEnv()
    let {tier, path } = getTestNGXML({distroMajor: 7, variant: "Server", arch: "x8664"})
    t.is(path, fullFakePath)
})
