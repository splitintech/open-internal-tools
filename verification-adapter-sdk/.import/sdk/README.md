# SplitIn Verification Adapter SDK

Internal, provider-neutral contract for SplitIn identity and business verification adapters.

An adapter is accepted only when it supplies a validated V2 manifest, implements the full
server contract, passes the shared conformance suite, and is compiled into the reviewed
server registry. Database configuration cannot load arbitrary code or provider URLs.

This package deliberately contains no product authorization policy, provider credentials,
raw provider payload models, React code, or bank/payment/payout behavior.
