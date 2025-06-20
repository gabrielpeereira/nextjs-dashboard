import bcrypt from 'bcrypt';
import postgres from 'postgres';
import { invoices, customers, revenue, users } from '../lib/placeholder-data';

console.log('Verificando variável de ambiente:', process.env.POSTGRES_URL_NON_POOLING ? 'Definida' : 'Não definida');

function createConnection() {
  return postgres(process.env.POSTGRES_URL_NON_POOLING!, {
    ssl: 'require',
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    connection: {
      application_name: 'nextjs-dashboard-seed'
    }
  });
}

async function testConnection() {
  const sql = createConnection();
  try {
    const result = await sql`SELECT 1 as test`;
    return true;
  } catch (error) {
    console.error('Erro ao testar conexão:', error);
    return false;
  } finally {
    await sql.end();
  }
}

async function checkUuidExtension() {
  const sql = createConnection();
  try {
    const result = await sql`
      SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp';
    `;
    if (result.length === 0) {
      await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
    }
  } catch (error) {
    console.error('Erro ao verificar/criar extensão:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

async function checkUsersTable() {
  const sql = createConnection();
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `;
    
    if (!result[0].exists) {
      await sql`
        CREATE TABLE users (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL
        );
      `;
    }
  } catch (error) {
    console.error('Erro ao verificar/criar tabela users:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

async function seedUsers() {
  if (!await testConnection()) {
    throw new Error('Falha ao testar conexão com o banco');
  }
  
  for (const user of users) {
    const sql = createConnection();
    try {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      try {
        await sql`
          INSERT INTO users (id, name, email, password)
          VALUES (${user.id}, ${user.name}, ${user.email}, ${hashedPassword});
        `;
      } catch (insertError) {
        if (insertError instanceof Error && 
            (insertError.message.includes('duplicate key') || 
             insertError.message.includes('violates unique constraint'))) {
          continue;
        }
        throw insertError;
      }
    } catch (error) {
      console.error(`Erro ao processar usuário ${user.email}:`, error);
      throw error;
    } finally {
      await sql.end();
    }
  }
  
  return users;
}

async function seedCustomers() {
  const sql = createConnection();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        image_url VARCHAR(255) NOT NULL
      );
    `;

    const insertedCustomers = await Promise.all(
      customers.map(
        (customer) => sql`
          INSERT INTO customers (id, name, email, image_url)
          VALUES (${customer.id}, ${customer.name}, ${customer.email}, ${customer.image_url})
          ON CONFLICT (id) DO NOTHING;
        `,
      ),
    );

    return insertedCustomers;
  } finally {
    await sql.end();
  }
}

async function seedInvoices() {
  const sql = createConnection();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        customer_id UUID NOT NULL,
        amount INT NOT NULL,
        status VARCHAR(255) NOT NULL,
        date DATE NOT NULL
      );
    `;

    const insertedInvoices = await Promise.all(
      invoices.map(
        (invoice) => sql`
          INSERT INTO invoices (customer_id, amount, status, date)
          VALUES (${invoice.customer_id}, ${invoice.amount}, ${invoice.status}, ${invoice.date})
          ON CONFLICT (id) DO NOTHING;
        `,
      ),
    );

    return insertedInvoices;
  } finally {
    await sql.end();
  }
}

async function seedRevenue() {
  const sql = createConnection();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS revenue (
        month VARCHAR(4) NOT NULL UNIQUE,
        revenue INT NOT NULL
      );
    `;

    const insertedRevenue = await Promise.all(
      revenue.map(
        (rev) => sql`
          INSERT INTO revenue (month, revenue)
          VALUES (${rev.month}, ${rev.revenue})
          ON CONFLICT (month) DO NOTHING;
        `,
      ),
    );

    return insertedRevenue;
  } finally {
    await sql.end();
  }
}

export async function GET() {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const sql = createConnection();
      try {
        await checkUuidExtension();
      } finally {
        await sql.end();
      }
      
      const sql2 = createConnection();
      try {
        await checkUsersTable();
      } finally {
        await sql2.end();
      }
      
      const users = await seedUsers();
      const customers = await seedCustomers();
      const invoices = await seedInvoices();
      const revenue = await seedRevenue();
      
      return new Response(
        JSON.stringify({
          message: 'Database seeded successfully',
          details: {
            usersCreated: users.length,
            customersCreated: customers.length,
            invoicesCreated: invoices.length,
            revenueCreated: revenue.length
          }
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`Erro na tentativa ${retryCount + 1}:`, error);
      
      if (error instanceof Error && error.message.includes('CONNECTION_CLOSED')) {
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          details: error,
          attempt: retryCount + 1
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  }
}