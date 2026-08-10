# Memstream infra (AWS CDK)

TypeScript source of truth for the EC2 demo box and Lambda CDC worker.

```bash
# from repo root
npm install
npm run synth:infra   # writes infra/ec2.yaml + infra/lambda.yaml
```

Edit stacks under `lib/`, userdata under `assets/ec2-userdata.sh`.  
Do not hand-edit generated `infra/ec2.yaml` / `infra/lambda.yaml`.

Enable / `make deploy-aws` still deploy via CloudFormation using those generated templates (parameterized stacks — no `cdk deploy` required on the demo box).
