/**This module contains the schema used for graphql
 * 
 */

import { buildSchema } from "graphql"

let schema = buildSchema(`
    enum Arch {
        x8664
        x86_64
        aarch64
        ppc64
        ppc64le
        s390
        s390x
    }

    enum Executor {
        beaker
        ci-osp
    }

    type MetricsTest {
        executor: Executor!,
        arch: Arch!,
        executed: Int!,
        failed: Int!,
        passed: Int!
    } 

    enum BuildType {
        official
        internal
    }

    type Metrics = { 
        component: String!,
        trigger: String!,
        tests: [MetricsTest]!,
        jenkins_job_url: String!,
        jenkins_build_url: String!,
        logstash_url: String,
        CI_tier: Int,
        base_distro: String!
        brew_task_id: String,
        compose_id: String,
        create_time: String!,
        completion_time: String!,
        CI_infra_failure: String,
        CI_infra_failure_desc: String,
        job_name: String!,
        build_type: BuildType!,
        team: String!,
        recipients: [String]!,
        artifact: String
    }
    
    type {

    }
`)