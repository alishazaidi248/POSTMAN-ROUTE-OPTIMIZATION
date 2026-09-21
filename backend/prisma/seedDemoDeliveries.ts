import { PrismaClient, ParcelPriority } from "@prisma/client";

/**
 * OPTIONAL demo data for trying the postman route features — NOT run by
 * `prisma:seed`. Creates ASSIGNED deliveries with real coordinates around the
 * seeded Bhandup West post office for the two seeded postmen. Re-running
 * resets these deliveries to ASSIGNED, so you can replay a delivery round.
 *
 *   npm run prisma:seed:demo
 *
 * The coordinates are listed in a deliberately scrambled geographic order so
 * you can see that the optimized route is not the database/insertion order.
 */
const prisma = new PrismaClient();

interface DemoDelivery {
  trackingId: string;
  recipient: string;
  phone: string;
  line1: string;
  area: string;
  latitude: number;
  longitude: number;
  parcelCount: number;
  parcelType: string;
  priority: ParcelPriority;
  postman: "PM-BHW-001" | "PM-BHW-002";
}

const DEMO: DemoDelivery[] = [
  { trackingId: "DEMO-BHW-001", recipient: "Rahul Sharma", phone: "9820100001", line1: "12, Station Road", area: "Bhandup West", latitude: 19.1498, longitude: 72.9268, parcelCount: 2, parcelType: "Speed Post", priority: "NORMAL", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-002", recipient: "Anita Deshmukh", phone: "9820100002", line1: "5, Sonapur Lane", area: "Bhandup West", latitude: 19.1421, longitude: 72.9352, parcelCount: 6, parcelType: "Parcel", priority: "NORMAL", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-003", recipient: "Imran Sheikh", phone: "9820100003", line1: "88, LBS Marg", area: "Bhandup West", latitude: 19.1452, longitude: 72.9310, parcelCount: 1, parcelType: "Letter", priority: "URGENT", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-004", recipient: "Priya Nair", phone: "9820100004", line1: "3, Tembhipada Road", area: "Bhandup West", latitude: 19.1408, longitude: 72.9260, parcelCount: 3, parcelType: "Parcel", priority: "NORMAL", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-005", recipient: "Vikas Patil", phone: "9820100005", line1: "21, Dreams Mall Road", area: "Bhandup West", latitude: 19.1475, longitude: 72.9330, parcelCount: 1, parcelType: "Registered Post", priority: "HIGH", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-006", recipient: "Meera Joshi", phone: "9820100006", line1: "9, Pratap Nagar", area: "Bhandup West", latitude: 19.1441, longitude: 72.9289, parcelCount: 4, parcelType: "Parcel", priority: "NORMAL", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-007", recipient: "Sanjay More", phone: "9820100007", line1: "40, Kokan Nagar", area: "Bhandup West", latitude: 19.1490, longitude: 72.9335, parcelCount: 1, parcelType: "Letter", priority: "LOW", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-008", recipient: "Kavita Rao", phone: "9820100008", line1: "17, Jangal Mangal Road", area: "Bhandup West", latitude: 19.1463, longitude: 72.9300, parcelCount: 2, parcelType: "Speed Post", priority: "NORMAL", postman: "PM-BHW-001" },
  { trackingId: "DEMO-BHW-101", recipient: "Farhan Qureshi", phone: "9820100101", line1: "2, Ashok Nagar", area: "Bhandup West", latitude: 19.1385, longitude: 72.9405, parcelCount: 2, parcelType: "Parcel", priority: "NORMAL", postman: "PM-BHW-002" },
  { trackingId: "DEMO-BHW-102", recipient: "Lata Gaikwad", phone: "9820100102", line1: "14, Hanuman Nagar", area: "Bhandup West", latitude: 19.1352, longitude: 72.9366, parcelCount: 1, parcelType: "Letter", priority: "NORMAL", postman: "PM-BHW-002" },
  { trackingId: "DEMO-BHW-103", recipient: "Ravi Menon", phone: "9820100103", line1: "30, Vihar Road", area: "Bhandup West", latitude: 19.1411, longitude: 72.9384, parcelCount: 3, parcelType: "Parcel", priority: "HIGH", postman: "PM-BHW-002" }
];

async function main() {
  const postOffice = await prisma.postOffice.findUniqueOrThrow({ where: { code: "MUM-BHW-400078" } });
  const postmen = await prisma.postman.findMany({ where: { employeeId: { in: ["PM-BHW-001", "PM-BHW-002"] } } });
  if (postmen.length !== 2) throw new Error("Run `npm run prisma:seed` first (the demo postmen are missing).");

  for (const d of DEMO) {
    const postman = postmen.find((p) => p.employeeId === d.postman)!;
    const existing = await prisma.delivery.findUnique({ where: { trackingId: d.trackingId } });

    if (existing) {
      await prisma.delivery.update({ where: { id: existing.id }, data: { status: "ASSIGNED" } });
      continue;
    }

    const recipient = await prisma.recipient.create({ data: { name: d.recipient, phone: d.phone } });
    const address = await prisma.address.create({
      data: {
        recipientId: recipient.id,
        addressLine1: d.line1,
        area: d.area,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400078",
        latitude: d.latitude,
        longitude: d.longitude,
        geocodingStatus: "MANUAL",
        geocodingSource: "demo-seed",
        geocodedAt: new Date()
      }
    });

    await prisma.delivery.create({
      data: {
        trackingId: d.trackingId,
        recipientId: recipient.id,
        addressId: address.id,
        parcelType: d.parcelType,
        parcelCount: d.parcelCount,
        priority: d.priority,
        status: "ASSIGNED",
        postOfficeId: postOffice.id,
        beatId: postman.assignedBeatId,
        assignedPostmanId: postman.id
      }
    });
  }

  console.log(`Demo deliveries ready: ${DEMO.length} (all ASSIGNED).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
