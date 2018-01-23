//@flow

declare module "metricizer" {
    declare export type URLOpts  = {
        jenkins_url: string,
        user: string,
        job: string,
        build: number,
        pw: string, 
        tab: string
    }

    declare export type JenkinsJob  = {
        jenkins_url: string,
        user: string,
        job: string,
        build: number,
        pw: string, 
        tab: string,
        template: string
    }

    declare export type Calculated = {
        total: number, 
        failures: number, 
        errors: number, 
        passed: number, 
        time: number
    }
    
    declare export type Property = {
        name: string,
        value: string
    }
    
    declare export type TestValue = {
        total: Calculated,
        props: any
    }

    declare type StreamType = "ci-message" 
                            | "trigger" 
                            | "test-results" 
                            | "ci-time" 
                            | "env-vars"
    
    declare export type StreamResult<T> = {
        type: StreamType,
        value: T
    }

        // Correspons to schema.Arch
    declare export type Arch = "i386" 
                             | "aarch64" 
                             | "x8664" 
                             | "x86_64" 
                             | "s390" 
                             | "ppc64" 
                             | "ppc64le"

    // Corresponds to schema.MetricsTest
    declare export type MetricsTest =  
        { executor: "beaker" | "CI-OSP"
        , arch: Arch
        , executed: number
        , failed: number
        , passed: number 
        }

    declare export type Variant = "Server" 
                                | "Workstation" 
                                | "Client" 
                                | "ComputeNode"
    
    declare export type Distro = {
        major: number, 
        minor?: number,
        variant: Variant,
        arch: Arch
    }

    /**
     * Corresponds to schema.Metrics
     * 
     * This type represents what is needed by the CI Metrics JSON.
     */
    declare export type Metrics = 
        { component: string         // "subscription-manager-${SUBMAN_VERSION}"
        , trigger: string           //
        , tests: MetricsTest[]
        , jenkins_job_url: string   // "${JENKINS_URL}"
        , jenkins_build_url: string // "${BUILD_URL}"
        , logstash_url: string      // TODO: Ask boaz what this url is
        , CI_tier: number           // tells what tier the test is for
        , base_distro: string       // "RHEL 7.2+updates",  
        , brew_task_id: number      // from the CI_MESSAGE.json build -> task_id
        , compose_id: string        // FIXME: Is there a way to get this?  Seems to only be for nightlies tests
        , create_time: string       // Start time of jenkins job
        , completion_time: string   // Time when jenkins job completed
        , CI_infra_failure: string  // FIXME: Clarify what this is for
        , CI_infra_failure_desc: string // FIXME:  see above
        , job_name: string          // "${JOB_NAME}"
        , build_type: "official" | "internal"
        , team: string              // "rhsm-qe"
        , recipients: string[]      // ["jsefler", "jmolet", "reddaken", "shwetha", "jstavel"]
        , artifact: string          // TODO: Not sure what artifact to put here.  The polarion results?  the testng.xml?
        }
    
    declare export type Path = string
    
    declare export type CIMessageResult = {
            brewTaskID: string,
            version: string
    }

    declare export type StreamData = {
        trigger: string,
        testResults: StreamResult<TestValue>[],
        brewTaskID: string,
        components: string[],
        createTime: string,
        epoch: number,
        envVars: {}
    }

    declare export type PlatformLabel = Map<Variant, Map<Arch, string>>
}