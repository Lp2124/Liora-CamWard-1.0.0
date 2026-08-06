import { handleHappySeedsCallback } from '../../../../../lib/happyseeds-platform-auth';
import { upsertUserOnLogin } from '../../../../../lib/user-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleHappySeedsCallback(request, upsertUserOnLogin);
}
