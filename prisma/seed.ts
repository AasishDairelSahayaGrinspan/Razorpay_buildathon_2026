import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clear in FK order: audit → transaction → cartItem → cart → product
  await prisma.auditEvent.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.product.deleteMany({});

  const products = [
    {
      name: "Headphones — ANC WFH Pro",
      description: "Over-ear noise cancellation, 40h battery, beamforming mics for work calls. Comfortable for long WFH sessions.",
      category: "Audio",
      price: 399900, // ₹3,999
      currency: "INR",
      inventory: 22,
      active: true,
      tags: "headphones, anc, wfh, work, noise cancellation",
      features: JSON.stringify(["ANC", "40h battery", "Beamforming mics", "Bluetooth 5.3"]),
      image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Headphones — Lite Comfort",
      description: "Lightweight on-ear, 30h battery, balanced sound for daily calls.",
      category: "Audio",
      price: 249900,
      currency: "INR",
      inventory: 15,
      active: true,
      tags: "headphones, lightweight, comfort",
      features: JSON.stringify(["30h battery", "Lightweight", "On-ear"]),
      image: "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "USB Microphone — Studio Mini",
      description: "Cardioid USB-C mic, improves call quality, compatible with all headsets via USB.",
      category: "Audio",
      price: 79900, // ₹799
      currency: "INR",
      inventory: 35,
      active: true,
      tags: "microphone, usb, calls, wfh",
      features: JSON.stringify(["Cardioid", "USB-C", "Noise gate"]),
      image: "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Webcam — HD Pro 1080p",
      description: "1080p with auto-focus, built-in privacy shutter, low-light correction for WFH video.",
      category: "Peripherals",
      price: 349900,
      currency: "INR",
      inventory: 12,
      active: true,
      tags: "webcam, video, wfh, hd",
      features: JSON.stringify(["1080p", "Auto-focus", "Privacy shutter"]),
      image: "https://images.unsplash.com/photo-1587826080692-f439cd0b70da?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Keyboard — Mechanical Compact",
      description: "Compact 75% mechanical, tactile switches, quiet for calls, Bluetooth + USB-C.",
      category: "Peripherals",
      price: 499900,
      currency: "INR",
      inventory: 18,
      active: true,
      tags: "keyboard, mechanical, compact, wfh",
      features: JSON.stringify(["75%", "Tactile", "Bluetooth", "USB-C"]),
      image: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Mouse — Ergonomic Wireless",
      description: "Ergonomic wireless, 2.4GHz + Bluetooth, silent clicks for meetings.",
      category: "Peripherals",
      price: 129900,
      currency: "INR",
      inventory: 0, // out of stock to test unavailable
      active: true,
      tags: "mouse, wireless, ergonomic",
      features: JSON.stringify(["Ergonomic", "Silent clicks", "Wireless"]),
      image: "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Laptop Stand — Aluminum Adjustable",
      description: "Aluminum, 6-angle adjustable, improves posture for WFH desk setup.",
      category: "Accessories",
      price: 199900,
      currency: "INR",
      inventory: 20,
      active: true,
      tags: "stand, laptop, ergonomics, wfh",
      features: JSON.stringify(["Aluminum", "6 angles", "Foldable"]),
      image: "https://images.unsplash.com/photo-1587831990711-23ca6441447b?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "USB-C Hub — 7-in-1",
      description: "7 ports: HDMI 4K, 3× USB-A, SD/TF, PD 100W — expands laptop connectivity.",
      category: "Accessories",
      price: 249900,
      currency: "INR",
      inventory: 30,
      active: true,
      tags: "hub, usb-c, connectivity, hdmi",
      features: JSON.stringify(["7 ports", "HDMI 4K", "PD 100W"]),
      image: "https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Webcam Cover — Inactive Demo",
      description: "Should be hidden — inactive product.",
      category: "Accessories",
      price: 29900,
      currency: "INR",
      inventory: 100,
      active: false,
      tags: "inactive, demo",
      features: JSON.stringify([]),
      image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=600&q=80&auto=format&fit=crop",
    },
  ];

  for (const p of products) {
    await prisma.product.create({ data: p });
  }

  console.log(`Seeded ${products.length} products`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
