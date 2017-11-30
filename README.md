# metricizer

metricizer creates a simple JSON message suitable for the Red Hat CI metrics data

## Usage

First, install it:

```
git clone https://github.com/rarebreed/metricizer.git
cd metricizer
yarn install
```

Once you have it installed, you need build it and launch it

```
yarn build
node lib/src/server.js
```

This will start the express server on port 4000.  Currently, there is only a single API endpoint
called /cimetrics.  It takes json data like this:

```json
{
    "distro": {
        "major": 7,
        "variant": "Server",
        "arch": "x86_64"
    },
    "jenkins": {
        "tab": "QE-RHEL7.4",
        "job": "rhsm-rhel-7.4-AllDistros-Tier1Tests",
        "build": 61,
        "jenkins_url": "http://your.jenkins/url",
        "user": "your-jenkins-user",
        "pw": "password"
    }
}
```

To use it with curl, you can do this (note to fill in valid values for jenkins_url, user and pw):

```bash
JSON='{
    "distro": {
        "major": 7,
        "variant": "Server",
        "arch": "x86_64"
    },
    "jenkins": {
        "tab": "QE-RHEL7.4",
        "job": "rhsm-rhel-7.4-AllDistros-Tier1Tests",
        "build": 61,
        "jenkins_url": "http://your.jenkins/url",
        "user": "your-jenkins-user",
        "pw": "password"
    }
}'

curl -H "Content-Type: application/json" -X POST -d ${JSON} http://localhost:4000/cimetrics
```

Doing this curl command will result in the following output

```json
{
  "component": "nfs-ganesha-2.5.2-5.el7cp.x86_64.rpm",
  "trigger": "manual",
  "tests": [
    {
      "executor": "beaker",
      "arch": "x86_64",
      "executed": 261,
      "failed": 1,
      "passed": 56
    }
  ],
  "jenkins_job_url": "http://redacted.com/job/rhsm-rhel-7.4-AllDistros-Tier1Tests/",
  "jenkins_build_url": "http://redacted.com/job/rhsm-rhel-7.4-AllDistros-Tier1Tests/61/",
  "logstash_url": "",
  "CI_tier": 1,
  "base_distro": "RHEL 7.",
  "brew_task_id": 14275230,
  "compose_id": "",
  "create_time": "2017-07-22T16:08:00.595Z",
  "completion_time": "2017-07-22T16:08:25.957Z",
  "CI_infra_failure": "",
  "CI_infra_failure_desc": "",
  "job_name": "rhsm-rhel-7.4-AllDistros-Tier1Tests",
  "build_type": "internal",
  "team": "rhsm-qe",
  "recipients": [
    "jsefler",
    "jmolet",
    "reddaken",
    "shwetha",
    "stoner",
    "jstavel"
  ],
  "artifact": ""
}                                          
```

Note that if the CI_MESSAGE.json does not exist or is invalid (eg a 1b file), then a dummy default
value is used.  Currently, this is just to prove that metricizer works.  In the future, an error
will be thrown if the CI_MESSAGE.json was not found as an artifact.

## Running the tests

To run the unit tests, after running yarn build, you can run the AVA tests like this:

```
yarn run ava lib/test
```

This will run all the tests (that got compiled) from test/metrics.test.js 

### Test Configuration

A small configuration file is used to get the jenkins URL, a jenkins user and the password for 
that user in order to make some jenkins API calls to obtain needed data.  You can load json file(s)
with the following data:

```json
{
    "jenkins_url": "http://your.jenkins.url",
    "jenkins_user": "user-for-api-calls",
    "jenkins_pw": "password-for-user"
}
```