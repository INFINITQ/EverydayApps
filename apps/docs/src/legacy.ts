// Old Word 97-2003 documents (.doc). They open read-only through a converter that turns them
// into a .docx in memory; Folio never writes .doc files.

export async function convertDoc(bytes: Uint8Array): Promise<Uint8Array> {
  void bytes;
  throw new Error('Folio Docs can’t open Word 97-2003 (.doc) documents yet.');
}
