import { getSupabaseClient } from './supabaseClient';

async function main() {
  const client = getSupabaseClient();
  const { error } = await client.from('sessions').delete().neq('id', 0);
  if (error) console.error('Error deleting sessions:', error);
  else console.log('Successfully cleared sessions');
}

main().catch(console.error);
