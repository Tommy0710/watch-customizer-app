import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET() {
  const client = await clientPromise;
  const db = client.db('watch_customizer');
  const categories = await db.collection('faces').distinct('category');
  return NextResponse.json({ categories });
}
