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

## Some assumptions

The functionality makes a couple of assumptions about a team's jenkins jobs:

- It saves off an artifact called CI_MESSAGE.json (which contains the contents of the message delivered by the UMB to trigger your job) in $YOUR_JOB/artifact/test-output/CI_MESSAGE.json
- It saves off the xunit result in $YOUR_JOB/artifact/test-output/testng-polarion.xml

Where $YOUR_JOB has a url pattern like this:

```
`${jenkins_url}/view/${tab}/job/${job}/${build}${api}`
```

This in turn means that your jenkins jobs are separated out by tabs, because the REST calls will use a URL pattern like that.  

### Future solutions

The solution to the above assumptions is to stop making assumptions and pass in some new arguments:

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
        "pw": "password",
        "message": {
            "name": "my_ci_msg.json",
            "artifact-path": "http://path/to/your/artifact/directory"
        },
        "xunit": {
            "name": "name-of-my-xunit.xml",
            "artifact-path": "http://path/to/your/artifact/directory"
        } 
    }
}
```

If your jobs does not use tabs, then the URL pattern will change to not use it.  If your team doesn't use tabs to separate out 
jobs, you can simply pass in an empty string for the tab.

## Future work

metricizer was designed to be a little microservice.  My philosphy is that by trying to write everything as jenkins plugins, 
while it does simplify some things, it also makes others harder. Trying to implement functionality as jenkins plugins it 
introduces the following problems:

- Ties down your tests to running via jenkins
- Causes more devops trouble (every jenkins has to maintain and update new versions of the plugin)

As the old adage goes, "program to interfaces to implementations".  Try not to tie yourself down to a specific implementation.
That was the guiding principle behind polarize, and it's true for metricizer also.  Let other clients consume your service
in the way easiest for them instead of burying the functionality behind a jenkins plugins and forcing all the clients to be 
run from jenkins also.  Since REST (over html) is a near ubiquitous standard, this seems the most logical approach.  And indeed, 
it wouldn't take much extra to write a jenkins plugin which was just another client to this service.

By writing more functionality as microservices and simply using more ubiquitous REST calls, this eliminates both the problems 
above, but it does introduce some of its own problems.  However, I think it adds other advantages that are worthwhile:

- Can run your tests on any kind of runner (manual, TeamCity, Travis, etc)
- Single and centralized point of maintenance (maintain and update in one spot)
  - More work for one team, less work for everybody else

But the problem is that you now have to maintain the microservices.  Ideally, this would mean the following:

- An Openshift deployment
- Service discovery
- Failover
- Clustering

So for future work, it would be nice to implement a service discovery mechanism and some way to have failover/clustering in the
event one of the microservices fails and to support the possibility of high loads on the service.