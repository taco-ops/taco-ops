---
layout: post
title:  TIL about using envsubt with nFPM
description: intro
date:   2023-12-20 18:05:55 +0300
image:  '/images/yoda_1.png'
tags:   [TIL, DevOps, NFPM, Packaging, Templating]
#featured: true
---

# Makefiles make me crazy. 

How many `.PHONY` entries in a single Makefile is too many? I don't know but I do know that creating a Makefile, let alone maintaining them amongst several people, is never something I look forward to.

After searching for alternatives a bit this last year I stumbled upon `nFPM`. [NFPM](https://nfpm.goreleaser.com/) is a simple, 0-dependencies, `deb`, `rpm`, `apk`, and Arch Linux packager. It does not support all of the same formats as `fpm` but for my use case, it was a perfect fit. 

We can use YAML to write a [specification config file](https://nfpm.goreleaser.com/configuration/) that the `nFPM` binary will use to create the final RPM package. Yay. Last I checked YAML was orders of magnitude easier to create and maintain than the alternatve.

# Nice, nothing can go wrong!

There is one downside to using nFPM: it does _not_ support templating out of the box. There are also no plans to support templating either. This causes issues when we want to generate a YAML configuration for an RPM package on the fly. 

Why would we want to do that? Well, what if we have a pipeline that builds and packages a binary whenever a release is created? We'll need to create an `nfpm.yaml` file (it can be called anything but nFPM looks for the nfpm.yaml file in the current, unless otherwise specified) that contains our config for the rpm package but the values will be hardcoded.

For example, this is what a config file might normally look like:

{% highlight yaml %}
name: "My-Cool-Package"
arch: "amd64"
platform: "linux"
version: "1.0.0"
maintainer: "David Perez <david.perez_at_tacoops.io>"
description: |
  This is my cool package
license: "BSD-3-Clause"
rpm:
  summary: "My Cool Package"
contents:
- src: build/cool-package-contents/
  dst: /tmp/
{% endhighlight %}

All of our values are defined into our `nfpm.yaml` file. We then run the `nfpm` binary to create the package like so: 

{% highlight bash %}
nfpm pkg --packager rpm -f nfpm.yaml
{% endhighlight %}

This will result in the `My-Cool-Package-1.0.0-1.x86_64.rpm` file.

Sure, we could just bump version numbers and update anything else in the config file on next release but that process should be automated in some fashion in our pipeline.

Thoughts of using a heredoc to potentially generate configs on the fly entered my mind. 

# Enter envsubt and The Template of not Doom
The nFPM author _does_ suggest using a tool like `envsubt` as an ad-hoc templating tool. The `envsubt` program substitutes the values of environment variables. In normal operation mode, standard input is copied to standard output, with references to environment variables of the form $VARIABLE or ${VARIABLE} being replaced with the corresponding values.

What that means is we can replace any instance of a variable in a file with the value of an environment variable.

For example:
{% highlight bash %}
cat name.template
 Name: "${NAME}"

export NAME="David Perez"

envsubt < name.template > name.yaml

cat my_name.yaml
 Name: "David Perez"
{% endhighlight %}

A new YAML file is generated and the content of ${NAME} gets replaced with the env var value.

# YAY Us

With that in mind, we can create a YAML template file that looks something like this:

{% highlight yaml %}
name: "${NAME}"
arch: "${ARCH}"
platform: "${PLATFORM}"
version: "${VERSION}"
maintainer: "${MAINTAINER}"
description: |
  This is my cool package
license: "${LICENSE}"
rpm:
  summary: "My Cool Package"
contents:
- src: ${SRC}
  dst: ${DST}
{% endhighlight %}

We can populate/inject the necessary information we need to update our template file into environment variables during CI pipeline job runtime. This way we get the latest information we are looking to update our packaging config without having someone manually adjust them. 

Example Gitlab-CI job:

{% highlight yaml %}
.rpm-packaging:
  stage: Packaging
  image: rockylinux:8
  script:
    # copy repo config for goreleaser and install onto runner as well as envsubst
    # in case it is not already
    - cp -v goreleaser.repo /etc/yum.repos.d/
    - yum install -y nfpm gettext
    # we source a .env file to inject our environment variables
    # generated in an earlier build job
    - source .env
    # envsubt will replace all shell variables entries in nfpm.template
    # with the values we sourced from the .env file
    # This will allow us to create a custom nfpm.yaml script that will
    # contain the updated information for the new release
    - envsubst < nfpm.template > nfpm.yaml
    # Create RPM using nfpm.yaml config and store it in RPM directory
    - nfpm pkg --packager rpm -f nfpm.yaml --target RPM/
    # Get basic RPM information from generated file.
    - find RPM -type f -name "*.rpm" -exec rpm -qip {} \;
    - find RPM -type f -name "*.rpm" -exec rpm -qlp {} \;

my-cool-job:
  extends: .rpm-packaging
  before_script:
    - |
      if [[ -n "$DOTENV_CONTENTS" ]]; then
        echo "$DOTENV_CONTENTS" > .env
        echo "Created .env file"
      fi
  tags: my-cool-runner

{% endhighlight %}

# Gotchas and things to consider

You may have noticed there is a source/destination entry in the nfpm.yaml config above.

{% highlight yaml %}
contents:
- src: build/cool-package-contents/
  dst: /tmp/
{% endhighlight %}

The `src` tells nFPM where to find the artifacts we wish to package and `dst` indicates where on the filesystem the RPM should land when installed. This works well when there is a predetermined path that is uniform across all machines it may be installed on. Truth is, there may be use cases where we need to instaall this in the current users home directory. 

The main problem is we cannot know ahead of time which user is going to install the RPM package, so we have no way to substitute the src:dst variables at runtmie. nFPM also does not support using `${HOME}` environment variable in the YAML config file. 

# Post-install scripts to the rescue

According to the Fedora Project, we can leverage scriptlets to handle more complex logic before, during and after RPM installation. You can read more about it [here](https://docs.fedoraproject.org/en-US/packaging-guidelines/Scriptlets/). I decided to try and use the `%post` scriptlet method to do some transformation after installing the RPM.

Here was my thought process:
* We can hard code the `dst` path for the artifact to be `/tmp/artifact`
* During installation, the RPMM is installed in that location.
* Before RPM installation is complete, the `%post` scriplet is used to run a bash script that handles the logic for finding a users home directory and copying it there.
* RPM is copied to users home directory and RPM installation completes.

Thankfully, nFPM exposes the `postinstall` attribute via the `scripts` method, where we can then poinnt nFPM to our bash script to include and run during installation process.

{% highlight yaml %}
contents:
- src: build/cool-package-contents/
  dst: /tmp/
scripts:
  postinstall: post-install.bash
{% endhighlight %}

The contents of which could contain some logic similar to this:

{% highlight bash%}
#!/bin/bash

# Redirect both stdout and stderr to a log file
exec > >(tee -a /tmp/copy-artifact.log) 2>&1

# Set source and destination directories
source_dir="/tmp/artifact"
dest_dir="$HOME"

# Check if the source directory exists
if [[ -d "$source_dir" ]]; then
   # Attempt to copy the directory
   echo "Copying directory $source_dir to $dest_dir..."
   cp -r "$source_dir" "$dest_dir"
   rm -rf "$source_dir"

   if [[ $? -eq 0 ]]; then
       echo "Directory copied successfully."
   else
       echo "Error copying directory."
   fi
else
   echo "Directory $source_dir not found."
fi
{% endhighlight %}

# Anyways

That's how I used envsubt with nFPM. When I presented it to my teammates, they were all pretty stoked at not having to deal with Makefiles in our pipelines any longer.
