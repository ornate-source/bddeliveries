# Documentation

Welcome to the BDDeliveries documentation.

## Setup

```js
import { configure } from "bddeliveries";

configure({
  pathao: {
    clientId: process.env.PATHAO_CLIENT_ID,
    clientSecret: process.env.PATHAO_CLIENT_SECRET,
    username: process.env.PATHAO_USERNAME,
    password: process.env.PATHAO_PASSWORD,
  }
});
```

## Creating an Order

```js
import { createOrder } from "bddeliveries";

const order = await createOrder({
  gateway: "pathao",
  recipientName: "John Doe",
  address: "Dhaka",
  // ... other gateway specific fields
});
```

## Extending the Package (Adding a New Gateway)

The package uses a decentralized Open/Closed architecture. To add a new gateway, you don't need to touch `config.js` or `index.js`.

1. Create a new file in `src/gateways/` (e.g., `mycourier.js`).
2. Export your gateway's `META` requirements:
   ```javascript
   export const META = {
       envMap: {
           apiKey: "MYCOURIER_API_KEY",
           sandbox: "MYCOURIER_SANDBOX",
       },
       requiredKeys: ["apiKey"],
   };
   ```
3. Implement `createOrder`, `trackOrder`, and `cancelOrder` using the shared `request` utility from `src/utils.js`.
4. Register the new file inside `src/gateways/index.js`.
