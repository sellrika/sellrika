# Payment methods

The ways a shop takes money at the till (Cash, Card and so on), and how they are set up.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/settings.ts` |
| Controller | `app/controllers/PaymentMethod.Controller.ts` |
| Service | `app/services/settings/PaymentMethod.Service.ts` |
| Repository (`usable`, `seedDefaults`, `syncExtension`) | `app/repositories/PaymentMethod.Repository.ts` |
| Validator (`PaymentMethodInput`) | `app/validators/PaymentMethod.Validator.ts` |
| Constants (`PAYMENT_ICON_NAMES`, 25 lucide names) | `app/constants/PaymentMethod.Constant.ts` |
| Page | `resources/js/Pages/PaymentMethods/Index.vue` |
| Components | `components/IconPicker.vue`, `components/ColorPicker.vue`, `components/PaymentImage.vue` |
| Icon map (name → lucide component, `methodStyle(color)`) | `resources/js/lib/paymentIcons.ts` |
| The method buttons of every pay dialog | `resources/js/components/pos/PaymentMethodPicker.vue` |

## The page

The sidebar link is **Catalog › Payments**.

The page was built from the Pencil designs "Payments · List" and "Payments · Edit dialog".

There is one row per method. A row shows:

- the icon in the method's colour
- the name
- what it does at the till
- an "On customer screen" tag, when the method has a picture
- the Enabled switch
- edit and delete

One dialog does both **Add payment method** and edit. It has:

- the name, with a live badge preview
- the icon
- the colour
- the "Ask for the amount given" switch
- the picture box
- Cancel and Save

## The model

Payment methods are per shop.

| Field | Meaning |
|---|---|
| `name` | At most 50 characters |
| `icon` | One of the 25 names. Default `Wallet`. |
| `color` | `#rrggbb` or null |
| `image` | A picture for the customer's screen, like a QR code to pay. null = none. |
| `extension` | The key of the extension that added the method. null = the shop's own. |
| `tendered` | true = the checkout asks for the cash amount and shows the change. false = it pays exactly the total. |
| `enabled` | false = hidden from the checkout and refused there. Still listed. Still shown on old orders. |
| `position` | The order in the list |

### The picture

- It is one of the app's own uploads, in the shop's `payments` folder.
- Migration 0076 added the column.
- It is picked with `components/PaymentImage.vue` in the dialog.
- A picture that is replaced or removed is deleted from storage once nothing uses it. The same goes for the picture of a deleted method. `UploadRepository.inUse` decides.

### The extension column

- Migration 0077 added it.
- The form and the API never set it.

### What a shop starts with

Every shop starts with three methods:

| Name | Icon | Colour | Tendered |
|---|---|---|---|
| **Cash** | `Banknote` | green | yes |
| **Card** | `CreditCard` | blue | no |
| **Other** | `Wallet` | amber | no |

`seedDefaults` writes them when a shop is created and on first boot.
Migration 0008 did the same for the shops that existed then.

## Rules

### One picker

The method buttons of every pay dialog are `components/pos/PaymentMethodPicker.vue`:

- the Sell screen's checkout
- Record payment on the order page
- the extensions' own dialogs, through `api.paymentPicker()`

The picker also tells the customer screen what is picked. See [pos-checkout.md](pos-checkout.md) › Customer screen.

Change the buttons there, nowhere else.

### Methods added by an extension

An extension's manifest may have a `payment_method` block: `{ name, icon, color }`.
It gives the shop a method while the extension is switched on.

When the extension's settings are saved, `PaymentMethodRepository.syncExtension` runs (called from `Extension.Settings.ts`):

| The extension is | What happens |
|---|---|
| On, and the shop has its row | The row is switched on |
| On, and the shop has no row, but has a method with that name and no extension | That method becomes the extension's and is switched on |
| On, and the shop has neither | A new row is made |
| Off | The row is switched off. It is never deleted. |

The row is a normal one:

- The shop may rename it, recolour it or delete it.
- A deleted one comes back the next time the extension is saved switched on.
- The Payments page tags it "Added by an extension".

The extension knows its method by the `extension` column, not by the name.

### Orders keep the name

- `orders.payment_method` stores the **name** as text.
- So a rename or a delete never touches history.
- The pages find the icon and colour by name in the shop's current list.
- With no match they show a plain badge.

### At the checkout

- `PaymentMethodRepository.usable(shopId, name)` must be true: the method exists **and** is enabled.
- Else the answer is "That payment method isn't available".
- `PosController` sends only the enabled methods to the Sell screen (`listEnabled`).

### Delete

Delete refuses the shop's last method: "Keep at least one payment method".
The message comes back as `errors.delete`.

## Endpoints

For managers and admins.

| Route | Does |
|---|---|
| `GET /payment-methods` | The list page |
| `POST /payment-methods` | Adds a method |
| `PUT /payment-methods/:id` | Edits a method |
| `DELETE /payment-methods/:id` | Deletes a method |

All of them render the index page or go back to it.

The Orders list and Reports use the method list for filter tabs and breakdowns.
