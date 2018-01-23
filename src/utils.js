/**@flow 
 * 
 */
const Rx = require("rxjs/Rx")
const ur = require("unirest")
const fs = require("fs")
import type { JenkinsJob, URLOpts } from "metricizer";

export function getEnv(name: string): ?string {
    let s: ?string =  process.env[name]
    return s
}

export const getJenkinsAPI = ( url: string
                             , user: string
                             , pw: string
                             ) => {
    let req = ur.get(url)
        .header("Accept", "application/json")
        .auth(user, pw, true)
        .strictSSL(false)
    let req$ = Rx.Observable.bindCallback(req.end)
    return req$
}

/**
 * Creates a string which is a url path that other functions will use to make REST service calls to
 * 
 * TODO: The string should be a template which can be set from a config file
 * 
 * @param {*} opts 
 * @param {*} api 
 */
export const makeURL = (opts: URLOpts, api: string): string => {
    let { job, build, pw, tab, jenkins_url } = opts
    if (opts.tab !== "")
        return `${jenkins_url}/view/${tab}/job/${job}/${build}${api}`
    else
        return `${jenkins_url}/view/job/${job}/${build}${api}`
}

export const createURL = (opts: JenkinsJob, api: string) => {
    let { job, build, pw, tab, jenkins_url, template } = opts
    return eval('`' + template + '`')
}

export const getJenkinsfile = (opts: URLOpts, path: string) => {
    let url = makeURL(opts, path)
    console.log(`Getting artifact from ${url}`)
    let req$ = getJenkinsAPI(url, opts.user, opts.pw)
    return req$()
        .map(resp => resp.body)
        .catch(ex => {
            console.error("Could not retrieve artifact")
            return ""
        })
}

export const getJFile = (opts: JenkinsJob, path: string) => {
    let url = createURL(opts, path)
    console.log(`Getting artifact from ${url}`)
    let req$ = getJenkinsAPI(url, opts.user, opts.pw)
    return req$()
        .map(resp => resp.body)
        .catch(ex => {
            console.error("Could not retrieve artifact")
            return ""
        })
}

/**
 * Given the path to a xml file, convert it to a string and return as a stream
 * 
 * @param {*} path 
 */
export function getFile(path: string) {
    let readFile$ = Rx.Observable.bindNodeCallback(fs.readFile)
    let bf$ =  readFile$(path, "utf8").map(b => b.toString())
    return bf$
}
