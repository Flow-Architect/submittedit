# Spark Hackathon Compliance

SubmittedIt is governed by the following stable public submission requirements.

## Project provenance

- SubmittedIt must be a new solo project created during the Spark hackathon.
- Its repository must be public and contain a credible, incremental history created after the hackathon start.
- No code or Git history may be copied or imported from another project.
- Commit dates must be real; history must not be backdated, disguised, or suspiciously rewritten.

## Required public evidence

- A hosted web application must explain the product, provide the dynamic demo portal, support receipt verification, and disclose privacy and proof limitations.
- A real smart contract must be deployed on Monad Mainnet or Testnet. The final submission must publish its exact contract address and independently verifiable explorer details.
- A public demonstration video must show the real product in under three minutes.
- A public social post must describe the build and link to the product and repository.

## Current Monad deployment evidence

Goal 05 satisfies the contract-deployment evidence requirement on Monad Testnet, chain ID `10143`:

- `SubmissionReceiptRegistry` protocol version 1: [`0x63914900a2D3571F92506821a76c4036C3e25883`](https://testnet.monadvision.com/address/0x63914900a2D3571F92506821a76c4036C3e25883)
- Deployment transaction: [`0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e`](https://testnet.monadvision.com/tx/0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e), block `45213264`
- [MonadVision/Sourcify verification](https://sourcify-api-monad.blockvision.org/v2/verify/e136f18f-a9ba-4dac-879c-be0193376ec6): overall `match`, runtime `match`, and `creationMatch: null`
- Reviewed public manifest: [`deployments/monad-testnet.json`](../deployments/monad-testnet.json)

The [development-only health-check transaction](https://testnet.monadvision.com/tx/0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb) is synthetic contract validation only. It must not be presented as a product receipt, user filing, extension/verifier demo, automated-judge result, authority acknowledgment, or evidence of acceptance. The repository does not claim Mainnet deployment, creation-bytecode verification, production readiness, or an external security audit.

## Functional integrity

- The extension, demo portal, verifier, and onchain workflow must use live runtime data.
- Every repeated submission must produce a distinct receipt.
- Accepted and Rejected require a verified authoritative acknowledgment; site confirmation alone leaves the receipt Pending acceptance.
- Tampered receipt data must fail verification.
- No workflow may rely on a static receipt, transaction hash, explorer link, success response, screenshot, or other placeholder presented as working functionality.
- No feature may be described as complete unless a judge can exercise its real behavior.

## Privacy and representation

- The demo must use synthetic data and must not contain real tax records, notices, SSNs, banking information, addresses, or other personal tax data.
- Raw private form values must remain offchain.
- SubmittedIt must not imply IRS affiliation or claim that blockchain evidence overrides official records or proves legal timeliness.

The product's full truth and privacy boundaries are defined in [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md).
