import type { Metadata } from "next";
import QuoteForm from "@/components/QuoteForm";
import { PAGE_META, OG_IMAGE } from "@/lib/site";

export const metadata: Metadata = {
  title: PAGE_META.quote.title,
  description: PAGE_META.quote.description,
  alternates: { canonical: "/quote" },
  openGraph: {
    images: [OG_IMAGE],
    title: PAGE_META.quote.title,
    description: PAGE_META.quote.description,
    url: "/quote",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_META.quote.title,
    description: PAGE_META.quote.description,
  },
};

export default function QuotePage() {
  return <QuoteForm />;
}
