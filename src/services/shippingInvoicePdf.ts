import PDFDocument from 'pdfkit';
import { env } from '../config/env';

export type ShippingInvoicePdfData = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  courierCode: string;
  trackingNumber: string;
  itemDescription: string | null;
  freightType: string;
  weightLb: number;
  serviceFeeJmd: number;
  customFeeJmd: number;
  deliveryFeeJmd: number;
  discountJmd: number;
  totalJmd: number;
  supportEmail: string;
  whatsappNumber: string;
};

let logoPromise: Promise<Buffer> | undefined;

async function loadLogo() {
  if (!logoPromise) {
    logoPromise = (async () => {
      const response = await fetch(env.emailLogoUrl);
      if (!response.ok) throw new Error('Unable to load the Global Xend JA logo for the invoice.');
      return Buffer.from(await response.arrayBuffer());
    })();
  }
  try {
    return await logoPromise;
  } catch (error) {
    logoPromise = undefined;
    throw error;
  }
}

function formatMoney(value: number) {
  const formatted = Math.abs(value).toLocaleString('en-JM', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}JMD $${formatted}`;
}

export async function createShippingInvoicePdf(data: ShippingInvoicePdfData) {
  const logo = await loadLogo();
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    document.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    try {
      const left = 48;
      const right = 547;
      const width = right - left;
      document.image(logo, left, 42, { fit: [155, 58] });
      document.fillColor('#071A38').font('Helvetica-Bold').fontSize(25).text('INVOICE', 345, 47, { width: 202, align: 'right' });
      document.fillColor('#526078').font('Helvetica').fontSize(10).text(`Invoice no. ${data.invoiceNumber}`, 345, 80, { width: 202, align: 'right' });
      document.text(`Date: ${new Date(data.invoiceDate).toLocaleDateString('en-JM')}`, 345, 96, { width: 202, align: 'right' });

      document.fillColor('#26354c').font('Helvetica-Bold').fontSize(10).text('GLOBAL XEND JA', left, 116);
      document.font('Helvetica').fontSize(9).fillColor('#526078')
        .text('Top Hill, St. Elizabeth, Jamaica', left, 132)
        .text(data.supportEmail, left, 146)
        .text(`WhatsApp: ${data.whatsappNumber}`, left, 160);
      document.moveTo(left, 181).lineTo(right, 181).lineWidth(1).strokeColor('#e4eaf3').stroke();

      document.fillColor('#ff7900').font('Helvetica-Bold').fontSize(9).text('BILLED TO', left, 199);
      document.fillColor('#071A38').font('Helvetica-Bold').fontSize(12).text(data.customerName, left, 214, { width: 240 });
      document.fillColor('#526078').font('Helvetica').fontSize(9)
        .text(`Courier code: ${data.courierCode || 'Not available'}`, left, 233)
        .text(`Tracking number: ${data.trackingNumber}`, left, 248);
      document.fillColor('#ff7900').font('Helvetica-Bold').fontSize(9).text('SHIPMENT', 330, 199);
      document.fillColor('#526078').font('Helvetica').fontSize(9)
        .text(`Shipping type: ${data.freightType}`, 330, 214)
        .text(`Package weight: ${data.weightLb.toLocaleString('en-JM')} lb`, 330, 229);

      document.fillColor('#ff7900').font('Helvetica-Bold').fontSize(9).text('ITEM DESCRIPTION', left, 278);
      document.fillColor('#26354c').font('Helvetica').fontSize(10)
        .text(data.itemDescription?.trim() || 'Not provided', left, 294, { width });

      const tableTop = Math.max(334, document.y + 20);
      document.rect(left, tableTop, width, 25).fill('#071A38');
      document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
        .text('DESCRIPTION', left + 12, tableTop + 8)
        .text('AMOUNT (JMD)', right - 132, tableTop + 8, { width: 120, align: 'right' });
      const rows = [
        ['Custom fee / adjustment', data.customFeeJmd],
        ['Service fee', data.serviceFeeJmd],
        ['Delivery fee', data.deliveryFeeJmd],
        ['Discount', data.discountJmd > 0 ? -data.discountJmd : 0],
      ] as const;
      let rowTop = tableTop + 25;
      for (const [label, value] of rows) {
        document.rect(left, rowTop, width, 31).fill(rowTop % 2 === 0 ? '#f5f7fb' : '#ffffff');
        document.fillColor('#26354c').font('Helvetica').fontSize(10)
          .text(label, left + 12, rowTop + 10)
          .text(formatMoney(value), right - 132, rowTop + 10, { width: 120, align: 'right' });
        rowTop += 31;
      }
      document.moveTo(left, rowTop + 8).lineTo(right, rowTop + 8).lineWidth(1).strokeColor('#e4eaf3').stroke();
      document.fillColor('#071A38').font('Helvetica-Bold').fontSize(12)
        .text('GRAND TOTAL', left + 12, rowTop + 25)
        .fontSize(15).fillColor('#ff7900')
        .text(formatMoney(data.totalJmd), right - 190, rowTop + 22, { width: 178, align: 'right' });

      document.fillColor('#526078').font('Helvetica').fontSize(9)
        .text('Thank you for shipping with Global Xend JA.', left, 756, { width, align: 'center' })
        .text('You Shop. We Ship.', left, 772, { width, align: 'center' });
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
