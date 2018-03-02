# metricizer

The metricizer service can create a simple JSON message suitable for the Red Hat CI metrics data

**NOTE**

The requirements for the data we need to send for metrics collection has changed.  In order to make this tool more flexible and perhaps
useable by upstream, there needs to be some way to:

- Define the JMS message fields that triggers your tests
- A template or list of values you need to fill in

## What problem is metricizer solving?

If you have a Continuous Integration setup, then you probably have the following scenario:

1. Devs make a new commit and it passes their unit tests
2. Some build process takes the code and spits out an artifact or service to test
3. The artifacts are released to some staged repository and a message is released announcing it
4. Other tests receive this message or build event hook to kick off tests

So, when you execute your tests, there's a lot of metadata that perhaps your organization would like to know about.  In other words, 
it's not just the test results that matter, but information about the testing itself.  For example:

- What kind of system did your test run on?  (Openstack, openshift, KVM, bare metal?)
- What version artifact(s) and their dependency chain were you testing?
- What platform(s) did you test on? (RHEL 7.5 Server, Fedora 27, Java 8, etc)
- Was your test sitting in a queue a long time? (ie, it received signal to test, but was bottlenecked by previous tests?)

There are all kinds of information that is important other than the results of the tests itself.  This data needs to be collected
and reported.  So metricizer is one (for a specific build process) to help do this.

**NOTE** this is a very Red Hat specific tool, however, with some work it could be made more generic.

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
        "pw": "password",
        "template": 
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

Currently, metricizer is very specific to Red Hat's process for CI workflows.  What is needed to make this more generic is to 
specify a 'pipeline' of sorts

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


### No assumption on jenkins

The code currently assumes the test runner was jenkins, but it would be nice to remove that and abstract out any of those bits
so that this service could be used by any kind of test runner (eg Travis, or manually executed).

For the metrics data collection we really need the following pieces of information:

- Information from whatever builds your product artifact(s)
  - Eg.What was the koji ID that built that the rpms
- Information about the test itself
  - What was the results of the test
  - logging information
- Who or what ran the test
  - What was the runner of the test (jenkins, manual)?

So what we really need to provide to the service are:

1. The message that came on the UMB from your build process
2. The xunit result file
3. Information about the test runner
4. Miscellaneous information passed to service

## Future work

metricizer was designed to be a little microservice.  My philosphy is that by trying to write everything as jenkins plugins, 
while it does simplify some things, it also makes others harder. Trying to implement functionality only as jenkins plugins 
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
