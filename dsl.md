# Utility service endpoints

/file

{
    "url": "/path/to/artifact",
    "jenkins": {
        "tab": "QE-RHEL7.4",
        "job": "rhsm-rhel-7.4-AllDistros-Tier1Tests",
        "build": 61,
        "jenkins_url": "http://your.jenkins/url",
        "user": "your-jenkins-user",
        "pw": "password",
        "template": "${jenkins_url}/view/${tab}/job/${job}/${build}${api}"
    }
}