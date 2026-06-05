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
