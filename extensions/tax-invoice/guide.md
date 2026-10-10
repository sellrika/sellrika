# Tax Invoice

Print a tax invoice for a paid order, with the buyer's name, address and tax ID. It works in any country.

## Set it up

1. Set the shop's tax first: **Shops › Edit › Tax / VAT**. An order with no tax gets no tax invoice.
2. Open **Settings › Extensions**, switch **Tax Invoice** on and press **Configure**.
3. Fill in the **Seller name**, the **Seller address** and the **Seller tax ID**, as they are registered. The tax ID is printed as you type it.
4. **Branch**: optional. It is printed under the tax ID when filled.
5. **Invoice number prefix**: the text in front of the order number. Empty gives `INV-`, so order `9JDW-QTGP-FR7U` gets invoice `INV-9JDW-QTGP-FR7U`.

## Print a tax invoice

1. Open the order from **Sales › Orders**. It must be paid.
2. Press **Tax invoice** at the top right.
3. Type the buyer's name and address. The tax ID and the branch are optional. When the order has a customer, the form starts with that customer's name and first saved address, with the address's **Tax ID**. With saved addresses, pick the one to use under **Saved address**: its tax ID comes with it. Add addresses and their tax IDs on the customer's page.
4. Press **Save and print**. The browser's print window opens with an A4 page.

## Good to know

- The invoice number is the prefix and the order number. It gets its date the first time you save it. The number and the date never change after that.
- Opening **Tax invoice** again on the same order prints the same invoice. You may correct the buyer's details.
- The tax line uses the shop's own tax label (VAT, GST…) and rate, as they were when the order was made.
- A voided or fully refunded order gets no tax invoice.
- The app does not make credit notes. After a refund, write the credit note yourself.
