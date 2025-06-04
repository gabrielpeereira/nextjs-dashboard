import postgres from 'postgres';

const sql = postgres(process.env.POSTGRES_URL_NON_POOLING!, {
  ssl: 'require',
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
  connection: {
    application_name: 'nextjs-dashboard-seed'
  }
});

export async function GET() {
  try {
    // Tenta fazer uma query simples
    const result = await sql`SELECT 1 as test`;
    return Response.json({ 
      message: 'Database connection successful',
      result 
    });
  } catch (error) {
    console.error('Database connection error:', error);
    return Response.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error,
      env: {
        hasUrl: !!process.env.POSTGRES_URL_NON_POOLING,
        urlLength: process.env.POSTGRES_URL_NON_POOLING?.length,
        url: process.env.POSTGRES_URL_NON_POOLING?.replace(/:[^:]*@/, ':****@') // Esconde a senha
      }
    }, { status: 500 });
  }
} 