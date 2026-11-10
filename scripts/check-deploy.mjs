import { unstable_readConfig } from 'wrangler';

const { d1_databases } = unstable_readConfig({ config: 'wrangler.jsonc' });
const id = d1_databases.find(database => database.binding === 'DB')?.database_id;

if (!id || id === '00000000-0000-0000-0000-000000000000') {
  console.error('Deploy bloqueado: configure d1_databases[].database_id do binding DB em wrangler.jsonc.');
  console.error('Execute `npx wrangler d1 create sinapse`, copie o ID real e aplique `npx wrangler d1 migrations apply DB --remote`.');
  process.exitCode = 1;
}
