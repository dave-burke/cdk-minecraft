# Minecraft Spot Pricing Server with AWS CDK

This is a version of [minecraft-spot-pricing](https://github.com/vatertime/minecraft-spot-pricing) converted to [CDK](https://aws.amazon.com/cdk/) code.

There is a construct (`lib/cdk-minecraft-spot-pricing.ts`) that I may publish as an independent NPM module in the future, and a stack (`lib/cdk-minecraft-stack`) that uses the construct and adds extra autoscaling rules to shut down the server when not in use.

## Example .env file

```
DEBUG=true
TIMEZONE_OFFSET=-5
CONTAINER_ENV={"DIFFICULTY":"normal"}
HOSTED_ZONE_ID="ABC123"
DNS_RECORD_NAME="minecraft.example.com"
```

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template

