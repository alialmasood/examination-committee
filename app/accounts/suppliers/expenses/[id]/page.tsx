import { ExpenseDetail } from '../../_components/ExpensePages';
export default async function Page({params}:{params:Promise<{id:string}>}){return <ExpenseDetail id={(await params).id}/>;}
