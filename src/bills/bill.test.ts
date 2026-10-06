import { describe, it, expect } from 'vitest';
import { parseBill, rowsFromBoxes, type TextBox } from './bill';
import { format } from '@/money/money';

const GROCERY = [
  'FRESH MART SUPERMARKET',
  'Shop 4, Sector 12, Noida',
  'GSTIN: 09ABCDE1234F1Z5',
  'TAX INVOICE',
  'Bill No: 4521   Date: 26/09/2026',
  'Item Qty Rate Amount',
  'Amul Paneer 200g 1 90.00 90.00',
  'Bread Brown 400g 2 x 45.00 90.00',
  'Buttermilk 500ml 3 x 20.00 60.00',
  'Whey Protein 1kg 1 2,499.00 2,499.00',
  'Sub Total 2,739.00',
  'CGST 2.5% 0.00',
  'Discount 0.00',
  'Grand Total 2,739.00',
  'Paid by UPI 2,739.00',
];

describe('reading a bill', () => {
  it('finds the shop, the date and the total', () => {
    const bill = parseBill(GROCERY);
    expect(bill.merchant).toBe('FRESH MART SUPERMARKET');
    expect(bill.date).toBe('2026-09-26');
    expect(format(bill.total!)).toBe('Rs 2,739.00');
  });

  it('lists what was bought, with quantities, and leaves out tax and totals', () => {
    const bill = parseBill(GROCERY);
    expect(bill.items.map((i) => i.name)).toEqual([
      'Amul Paneer 200g',
      'Bread Brown 400g',
      'Buttermilk 500ml',
      'Whey Protein 1kg',
    ]);
    expect(bill.items[1]).toMatchObject({ quantity: 2 });
    expect(format(bill.items[1].amount)).toBe('Rs 90.00');
    expect(bill.itemsMatchTotal).toBe(true);
  });

  it('reads an Amazon-style invoice with the rupee sign', () => {
    const bill = parseBill([
      'Tax Invoice/Bill of Supply/Cash Memo',
      'Sold By: Cloudtail India Private Ltd',
      'Order Date: 24.09.2026',
      '1 boAt Airdopes 141 Qty 1 ₹1,299.00',
      'Shipping Charges ₹40.00',
      'TOTAL: ₹1,339.00',
    ]);
    expect(bill.merchant).toBe('Cloudtail India Private Ltd');
    expect(bill.date).toBe('2026-09-24');
    expect(format(bill.total!)).toBe('Rs 1,339.00');
    expect(bill.items[0]).toMatchObject({ name: 'boAt Airdopes 141', quantity: 1 });
  });

  it('says when the items do not add up, so the user checks them', () => {
    const bill = parseBill(['CAFE', 'Coffee 150.00', 'Total 300.00']);
    expect(bill.itemsMatchTotal).toBe(false);
  });

  it('rebuilds printed rows from separate text boxes', () => {
    const boxes: TextBox[] = [
      { text: '90.00', box: [800, 402, 880, 430] },
      { text: 'Amul Paneer 200g', box: [40, 400, 400, 432] },
      { text: 'Grand Total', box: [40, 600, 300, 635] },
      { text: '90.00', box: [800, 603, 880, 633] },
    ];
    expect(rowsFromBoxes(boxes)).toEqual(['Amul Paneer 200g 90.00', 'Grand Total 90.00']);
  });

  it('reads a photo whose text recognition split an amount and dropped some quantities', () => {
    // As the emulator's text recognition read a made-up printed receipt.
    const bill = parseBill([
      'FRESH BASKET SUPERMARKET',
      'Bill No: 4471 Date: 05/10/2026',
      'Item Qty Rate Amount',
      'Toor Dal 1kg 165.00 165.00',
      'Amul Butter 500g 285.0 285.00',
      'Bananas 6 8.00 48.00',
      'Basmati Rice 5kg 1 620.00 620.00',
      'Total Items: 4',
      'Grand Total 1118. 00',
      'Paid by UPI 1118.00',
    ]);
    expect(format(bill.total!)).toBe('Rs 1,118.00');
    expect(bill.itemsMatchTotal).toBe(true);
    expect(bill.items.map((i) => [i.name, i.quantity])).toEqual([
      ['Toor Dal 1kg', undefined],
      ['Amul Butter 500g', undefined],
      ['Bananas', 6],
      ['Basmati Rice 5kg', 1],
    ]);
  });

  it('copes with a bill it cannot read', () => {
    const bill = parseBill(['', 'thank you visit again']);
    expect(bill.items).toHaveLength(0);
    expect(bill.total).toBeUndefined();
  });
});

describe('reading real vendor GST invoices (Blinkit, Zomato, Myntra)', () => {
  // The layout of a real invoice (names, addresses and numbers made up), both GST sub-invoices
  // concatenated as layoutText would produce them: item invoice + platform fee.
  const ZOMATO = [
    'Tax Invoice',
    'ORIGINAL FOR RECIPIENT',
    'Tax Invoice on behalf of -',
    'Legal Entity Name: SAMPLE FOODS',
    'Restaurant Name: Sample Chai Corner',
    'Restaurant Address: 12, Example Road, Sample Nagar, Sampletown',
    'Restaurant GSTIN: 09AAAAA0000A1Z5',
    'Restaurant FSSAI: 10000000000001',
    'Invoice No.: 26XX00AA00001234',
    'Invoice Date: 17/07/2026',
    'Customer Name: A Sample Customer',
    'Delivery Address: Flat 1, Example Apartments, Sampletown, 100001',
    'State name and Place of Supply: Uttar Pradesh (9)',
    'HSN Code: 996331',
    'Service Description: Restaurant Service',
    'Particulars Gross value Discount Net value CGST (Rate) CGST (INR) SGST (Rate) SGST (INR) Total',
    '1 x Veg Noodles 180 0.00 180.00 2.50% 4.50 2.50% 4.50 189.00',
    '1 x Paneer Wrap 145 0.00 145.00 2.50% 3.62 2.50% 3.62 152.25',
    'Item(s) Total 325.00 0.00 325.00 8.12 8.12 341.25',
    'Restaurant Packaging Charge 10.00 0.00 10.00 2.50% 0.25 2.50% 0.25 10.50',
    'Total Value 335.00 8.38 8.38 351.75',
    'Amount (in words): Three Hundred Fifty One Rupees And Seventy Five Paisa Only',
    'Amount of INR 351.75 settled digitally against Order ID 1000000001 dated 2026-07-17.',
    'Supply attracts reverse charge : No',
    'For ETERNAL LIMITED (FORMERLY KNOWN AS ZOMATO LIMITED)',
    'Tax Invoice',
    'ETERNAL LIMITED (FORMERLY KNOWN AS ZOMATO LIMITED)',
    'Invoice No: Z27XXXX000000001',
    'Invoice Date: 2026-07-17',
    'Customer Details',
    'Name: A Sample Customer',
    'GSTIN: UNREGISTERED',
    'Service Details',
    'HSN Code: 999799 Supply Description: Other Services N.E.C',
    'Sr.No Particulars Taxable Amount CGST SGST Total',
    '1 Platform fee 14.90 1.34 1.34 17.582',
    'Total 14.90 1.34 1.34 17.582',
    'Amount of ₹17.582 settled through digital mode/payment received against Order id (1000000001) dated (2026-07-17)',
  ];

  // The layout of a real Blinkit invoice (numbers made up): 3 GST sub-invoices concatenated (grocery
  // items sold by Blink Commerce, grocery items sold by Zomato Hyperpure, and a
  // handling-charge invoice). Item descriptions wrap onto their own lines,
  // separate from the MRP/Discount/Qty/.../Total row, as PdfBox's per-line
  // text extraction actually produces for this table layout.
  const BLINKIT = [
    'blinkit',
    'Tax Invoice',
    'Sold By / Seller',
    'Blink Commerce Private Limited',
    'GSTIN : 05AAAAA1111A1Z5',
    'Invoice Number : C000000T00000001',
    'Order Id : 2000000001',
    'Invoice Date : 16-06-2026',
    'Sr. no UPC Item Description MRP Discount Qty. Taxable Value CGST (%) CGST (INR) SGST (%) SGST (INR) Cess (%) Additional Cess Val Total',
    '1 8906 0020 0443 0 Dr. Oetker',
    'FunFoods Veg',
    'Mayonnaise',
    'Original(Pack)',
    '(HSN-21039030)',
    '49.00 0.00 1 46.67 2.50 1.17 2.50 1.17 0.00 0.00 49.00',
    '- Delivery and other',
    'charges',
    '- - - 0.68 2.50 0.02 2.50 0.02 0 0.00 0.71',
    'Total 1 1.19 1.19 49.71',
    'Amount in Words: Forty-Nine Rupees And Seventy-One Paisa Only',
    'Tax Invoice',
    'Sold By / Seller',
    'ZOMATO HYPERPURE PRIVATE LIMITED',
    'GSTIN : 05AAAAA2222A1Z5',
    'Invoice Number : C000000T00000002',
    'Order Id : 2000000001',
    'Invoice Date : 16-06-2026',
    '1 8901 2621 8011 5 Amul Fresh Malai',
    'Paneer(Pack)',
    '(HSN-04063000)',
    '95.00 0.00 1 95.00 0.00 0.00 0.00 0.00 0.00 0.00 95.00',
    '2 8906 0100 9007 4 D\'lecta Processed',
    'Cheese',
    'Slices(Pack) (HSN-',
    '04063000)',
    '180.00 59.00 1 115.24 2.50 2.88 2.50 2.88 0.00 0.00 121.00',
    '3 3600 3800 0500 1 Green',
    'Cucumber(Pack)',
    '(HSN-07070000)',
    '16.00 0.00 1 16.00 0.00 0.00 0.00 0.00 0.00 0.00 16.00',
    '4 8906 0204 6067 6 Harvest Gold 100%',
    'Atta Whole Wheat',
    'Bread(Pack) (HSN-',
    '19051000)',
    '65.00 3.00 1 62.00 0.00 0.00 0.00 0.00 0.00 0.00 62.00',
    'Total 4 2.88 2.88 294.00',
    'Amount in Words: Two Hundred And Ninety-Four Rupees And Zero Paisa Only',
    'Tax Invoice',
    'Sold By',
    'Blink Commerce Private Limited',
    'GSTIN : 05AAAAA1111A1Z5',
    'Invoice Number: UKFI000000000003',
    'Order Id : ORD00000000004',
    'Invoice Date : 16-06-2026',
    'Sr. no HSN Code Item Description MRP Discount Qty. Taxable Value CGST (%) CGST (INR) SGST (%) SGST (INR) Total',
    '1 998549 Handling charge 4.290 0 1 3.630 9 0.330 9 0.330 4.290',
    'Total 0 1 3.630 0.330 0.330 4.290',
    'Amount in Words: Four Rupees And Twenty-Nine Paisa Only',
  ];

  // The layout of a real Myntra (Flipkart-fulfilled) invoice: the item invoice, a
  // platform-fee invoice, and a "Bill of Supply" for GTA freight — Flipkart is
  // the party liable for that freight's tax, so it is not part of what the buyer
  // paid and must not be added to the total or read as a purchased item.
  const MYNTRA = [
    'Tax Invoice',
    'Invoice Number: I0000SN000000001 PacketID: 1000000002',
    'Order Number: 1000000-2000000-3000000 Invoice Date: 07 Aug 2025',
    'Bill From: Ship From:',
    'SAMPLE FASHION - SJIT',
    'GSTIN Number: 06AAAAA3333A1Z5',
    'Qty Gross Amount Discount OtherCharges Taxable Amount CGST SGST/ UGST IGST Cess Total Amount',
    'SKUSARS00000001(0000S000M) - Samplewear Mirror Work Pure Georgette Saree, Size: ONESIZE',
    'HSN: 54078470, 5.0% IGST',
    '1 Rs 5958.00 Rs 4842.00 Rs 0.00 Rs 1062.86 Rs 53.14 Rs 1116.00',
    'TOTAL Rs 5958.00 Rs 4842.00 Rs 0.00 Rs 1062.86 Rs 53.14 Rs 1116.00',
    'Tax Invoice',
    'Invoice Number: I0000MY000000002 Date: 07 Aug 2025',
    'Bill to / Ship to: Service Provider',
    'MYNTRA DESIGNS PVT LTD',
    'Qty Gross Amount Discount Other Charges Taxable Amount CGST SGST/UGST IGST Cess Total Amount',
    'Platform Fee',
    'HSN: 999799, 18.0% IGST',
    '1.0 Rs 20.00 Rs 0.00 Rs 0.00 Rs 16.95 Rs 3.05 Rs 20.00',
    'TOTAL Rs 20.00 Rs 0.00 Rs 0.00 Rs 16.95 Rs 3.05 Rs 20.00',
    'Bill of Supply Details',
    'Bill of Supply Number : I0000FI000000003',
    'Particulars SAC Qty Gross Amount Taxable Value SGST CGST Total',
    'GT charges 996511',
    '1.0 ₹194.00 ₹194.00 ₹0.00 ₹0.00 ₹194.00',
    'Total 1.0 ₹194.00 ₹194.00 ₹0.00 ₹0.00 ₹194.00',
  ];

  it('zomato: sums both sub-invoices, skips the packaging charge, does not pick the boilerplate line as the merchant', () => {
    const bill = parseBill(ZOMATO);
    expect(bill.merchant).not.toBe('ORIGINAL FOR RECIPIENT');
    expect(format(bill.total!)).toBe('Rs 369.33'); // 351.75 item total + 17.58 platform fee
    expect(bill.items.some((i) => /veg noodles/i.test(i.name) && format(i.amount) === 'Rs 189.00')).toBe(true);
    expect(bill.items.some((i) => /paneer wrap/i.test(i.name) && format(i.amount) === 'Rs 152.25')).toBe(true);
    expect(bill.items.some((i) => /packaging|platform/i.test(i.name))).toBe(false);
  });

  it('blinkit: reads items whose description wraps onto its own lines, sums all 3 sub-invoices, skips handling/delivery charges', () => {
    const bill = parseBill(BLINKIT);
    expect(format(bill.total!)).toBe('Rs 348.00'); // 49.71 + 294.00 + 4.29
    const names = bill.items.map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes('mayonnaise'))).toBe(true);
    expect(names.some((n) => n.includes('paneer'))).toBe(true);
    expect(names.some((n) => n.includes('cheese'))).toBe(true);
    expect(names.some((n) => n.includes('cucumber'))).toBe(true);
    expect(names.some((n) => n.includes('bread'))).toBe(true);
    expect(bill.items.some((i) => /handling|delivery/i.test(i.name))).toBe(false);
    expect(bill.items.find((i) => /mayonnaise/i.test(i.name))?.amount && format(bill.items.find((i) => /mayonnaise/i.test(i.name))!.amount)).toBe('Rs 49.00');
  });

  it('myntra: sums the item + platform fee, leaves out the GTA freight bill of supply (Flipkart pays that tax, not the buyer), picks the real seller as merchant', () => {
    const bill = parseBill(MYNTRA);
    expect(bill.merchant).toBe('SAMPLE FASHION - SJIT');
    expect(format(bill.total!)).toBe('Rs 1,136.00'); // 1116.00 item + 20.00 platform fee, NOT +194 GT charges
    expect(bill.items).toHaveLength(1);
    expect(bill.items[0].name).toMatch(/samplewear/i);
    expect(format(bill.items[0].amount)).toBe('Rs 1,116.00');
  });
});
