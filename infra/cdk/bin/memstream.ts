#!/usr/bin/env node
/** CDK app entry — synthesizes parameterized Memstream stacks. */

import * as cdk from "aws-cdk-lib";
import { MemstreamEc2Stack } from "../lib/ec2-stack.js";
import { MemstreamLambdaStack } from "../lib/lambda-stack.js";

const app = new cdk.App();

new MemstreamEc2Stack(app, "MemstreamEc2", {
  description: "Memstream EC2 demo box (parameterized)",
});

new MemstreamLambdaStack(app, "MemstreamLambda", {
  description: "Memstream Lambda CDC worker (parameterized)",
});

app.synth();
