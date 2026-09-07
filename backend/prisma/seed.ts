import { PrismaClient, TicketPriority, UserRole, UserType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SLA_HOURS: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
};

const CATEGORIES = ['Hardware', 'Rede', 'E-mail', 'Software'];

async function main() {
  for (const [priority, hours] of Object.entries(SLA_HOURS)) {
    await prisma.slaPolicy.upsert({
      where: { priority: priority as TicketPriority },
      update: { hours },
      create: { priority: priority as TicketPriority, hours },
    });
  }

  for (const name of CATEGORIES) {
    await prisma.category.upsert({
      where: { name },
      update: { active: true },
      create: { name, active: true },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD são obrigatórios.');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, type: UserType.INTERNAL, role: UserRole.ADMIN, active: true },
    create: {
      name: 'Administrador',
      email,
      passwordHash,
      type: UserType.INTERNAL,
      role: UserRole.ADMIN,
      active: true,
    },
  });

  console.log('Seed concluído.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
