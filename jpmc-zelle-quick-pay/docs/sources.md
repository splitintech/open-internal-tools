# Official sources and capability boundaries

Reviewed for this implementation: public documentation describes Corporate Quick Pay as corporate disbursement. It does not establish SplitIn's tenant-authorized embedded account-to-account flow. Public consumer/business Zelle instructions do not establish a universal launch URI or automatic receipt API. Do not invent either.

- https://developer.payments.jpmorgan.com/docs/quick-start
- https://developer.payments.jpmorgan.com/docs/treasury/corporate-quick-pay/doc
- https://developer.payments.jpmorgan.com/api/treasury/corporate-quick-pay/doc#/schemas/
- https://developer.payments.jpmorgan.com/api/treasury/corporate-quick-pay/doc#/paths/cqp-request/post
- https://developer.payments.jpmorgan.com/api/treasury/checks/overview
- https://developer.payments.jpmorgan.com/api/treasury/checks/error-codes
- https://developer.payments.jpmorgan.com/api/treasury/checks/checks#/schemas/CursorId
- https://developer.payments.jpmorgan.com/docs/commerce/online-payments/capabilities/online-payments
- https://www.zelle.com/business
- https://www.chase.com/business/support/payments/quickaccept/invoicing

The local `jpmc-zelle-quick-pay` skill is a development reference, not an official provider entitlement. No official JPMC MCP server has been configured for this implementation. MCP documentation access, when approved and available, does not authorize payment initiation or provide a reconciliation feed.
