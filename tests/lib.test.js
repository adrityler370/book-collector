// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/lib.js");

let n = 0;
const makeId = () => "id" + ++n;

test("toIsbn13 accepts ISBN-13 with hyphens and validates the check digit", () => {
  assert.equal(L.toIsbn13("978-0-306-40615-7"), "9780306406157");
  assert.equal(L.toIsbn13("9780306406158"), null);
  assert.equal(L.toIsbn13("8412345678901"), null); // EAN that is not a book
});

test("toIsbn13 converts ISBN-10, including X check digits", () => {
  assert.equal(L.toIsbn13("0-306-40615-2"), "9780306406157");
  assert.equal(L.toIsbn13("080442957X"), "9780804429573");
  assert.equal(L.toIsbn13("0306406153"), null);
});

test("norm and titleKey ignore accents, case, articles and subtitles", () => {
  assert.equal(L.norm("La Sombra del Viento"), "sombra del viento");
  assert.equal(L.titleKey("Sapiens: De animales a dioses"), "sapiens");
  assert.equal(L.titleKey("El Infinito en un Junco"), L.titleKey("infinito en un junco"));
});

const library = [
  { id: "a", title: "Cien años de soledad", author: "Gabriel García Márquez", isbn: "9780306406157" },
  { id: "b", title: "Patria", author: "Fernando Aramburu", isbn: "" },
  { id: "c", title: "Sapiens: De animales a dioses", author: "Yuval Noah Harari", isbn: "" },
];

test("findMatch prefers the ISBN, also when the probe is an ISBN-10", () => {
  assert.deepEqual(L.findMatch(library, { isbn: "0306406152", title: "otra cosa" }), { book: library[0], by: "isbn" });
});

test("findMatch finds another edition by title and author", () => {
  const m = L.findMatch(library, { isbn: "9780804429573", title: "PATRIA", author: "Aramburu, Fernando" });
  assert.equal(m.book.id, "b");
  assert.equal(m.by, "title");
  assert.equal(L.findMatch(library, { title: "Sapiens", author: "Yuval Noah Harari" }).book.id, "c");
});

test("findMatch rejects same title by a different author and short partial titles", () => {
  assert.equal(L.findMatch(library, { title: "Patria", author: "Robert Harris" }), null);
  assert.equal(L.findMatch(library, { title: "Pat" }), null);
  assert.equal(L.findMatch(library, { title: "" }), null);
});

test("fromGoogle maps a volume and forces https covers", () => {
  const b = L.fromGoogle({
    title: "Patria", authors: ["Fernando Aramburu"], publishedDate: "2016-09-06", publisher: "Tusquets",
    pageCount: 648, imageLinks: { thumbnail: "http://books.google.com/x?id=1&edge=curl" },
    industryIdentifiers: [{ type: "ISBN_10", identifier: "0306406152" }],
  });
  assert.deepEqual(b, { title: "Patria", author: "Fernando Aramburu", year: "2016", publisher: "Tusquets", pages: 648, cover: "https://books.google.com/x?id=1", isbn: "9780306406157" });
  assert.equal(L.fromGoogle({}), null);
});

test("fromOpenLibrary and fromOpenLibrarySearch map their shapes", () => {
  const e = L.fromOpenLibrary({ title: "Patria", authors: [{ name: "Fernando Aramburu" }], publish_date: "Sept 2016", publishers: [{ name: "Tusquets" }], cover: { medium: "https://covers.openlibrary.org/b/id/1-M.jpg" } }, "9780306406157");
  assert.equal(e.author, "Fernando Aramburu");
  assert.equal(e.year, "2016");
  const s = L.fromOpenLibrarySearch({ title: "Patria", author_name: ["Fernando Aramburu"], first_publish_year: 2016, isbn: ["bad", "0306406152"], cover_i: 42 });
  assert.equal(s.isbn, "9780306406157");
  assert.equal(s.cover, "https://covers.openlibrary.org/b/id/42-M.jpg");
});

test("sanitizeBook drops junk, keeps known fields and reads the artifact's thumb", () => {
  assert.equal(L.sanitizeBook({ title: "  " }, makeId), null);
  const b = L.sanitizeBook({ title: " Patria ", owned: 1, wish: true, rating: 9, isbn: "0306406152", thumb: "data:image/jpeg;base64,AAA", evil: "<script>" }, makeId);
  assert.equal(b.title, "Patria");
  assert.equal(b.owned, true);
  assert.equal(b.wish, false); // owned books are never on the wish list
  assert.equal(b.rating, 5);
  assert.equal(b.isbn, "9780306406157");
  assert.equal(b.cover, "data:image/jpeg;base64,AAA");
  assert.equal(b.evil, undefined);
  assert.equal(L.sanitizeBook({ title: "x", cover: "javascript:alert(1)" }, makeId).cover, "");
});

test("mergeBooks adds new books and keeps the newest copy of known ones", () => {
  const mine = [
    { id: "a", title: "Patria", author: "Fernando Aramburu", isbn: "", read: false, updatedAt: 100 },
    { id: "b", title: "Sapiens", author: "Harari", isbn: "", read: true, updatedAt: 500 },
  ];
  const backup = [
    { id: "zz", title: "Patria", author: "Fernando Aramburu", read: true, updatedAt: 200 }, // same book, newer
    { id: "b", title: "Sapiens", author: "Harari", read: false, updatedAt: 300 }, // older: ignored
    { id: "new", title: "Nada", author: "Carmen Laforet", updatedAt: 50 },
    { title: "" },
  ];
  const r = L.mergeBooks(mine, backup, makeId);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.books.length, 3);
  assert.equal(r.books.find((x) => x.id === "a").read, true);
  assert.equal(r.books.find((x) => x.id === "b").read, true);
  assert.equal(mine[0].read, false); // input not mutated
});
