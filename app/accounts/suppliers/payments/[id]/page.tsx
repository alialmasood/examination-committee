import { PaymentDetail } from '../../_components/PaymentPages';
export default async function Page({params}:{params:Promise<{id:string}>}){return <PaymentDetail id={(await params).id}/>;}
