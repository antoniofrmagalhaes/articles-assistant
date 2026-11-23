import type { SchemaTypeDefinition } from "sanity";
import { articleType } from "./articleType";
import {
  articleAuthorType,
  articleCalloutBlockType,
  articleFootnoteType,
  articleFrontMatterType,
  articleHeroType,
  articleLegalExcerptBlockType,
  articlePublicationType,
  articlePullQuoteBlockType,
  articleReferenceMatchType,
  articleReferenceType,
  articleRichTextBlockType,
  articleSectionType,
  articleSeoType,
  articleTaxonomyType,
} from "./articleSupportingTypes";

export const schemaTypes: SchemaTypeDefinition[] = [
  articleAuthorType,
  articleTaxonomyType,
  articlePublicationType,
  articleSeoType,
  articleHeroType,
  articleFrontMatterType,
  articleRichTextBlockType,
  articlePullQuoteBlockType,
  articleLegalExcerptBlockType,
  articleCalloutBlockType,
  articleSectionType,
  articleFootnoteType,
  articleReferenceMatchType,
  articleReferenceType,
  articleType,
];
