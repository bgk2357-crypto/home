import {accountAction} from '../../../account-actions';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){return accountAction(request,(await params).action);}
