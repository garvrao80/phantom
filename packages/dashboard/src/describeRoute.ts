// Turns a route key like "POST /projects/:id/upvote" into words a non-developer can read: "Upvote a project".
const singular = (word: string) =>
  word.endsWith("ies") ? word.slice(0, -3) + "y" : word.endsWith("s") ? word.slice(0, -1) : word;
const words = (segment: string) => segment.replace(/[_-]+/g, " ");
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");

export function describeRoute(key: string): string {
  const [method = "", path = ""] = key.split(" ");
  const parts = path.split("/").filter(Boolean);
  const isParam = (p: string) => p.startsWith(":");
  const names = parts.filter((p) => !isParam(p)).map(words);
  if (!names.length) return key;
  const last = parts.at(-1) ?? "";
  const lastName = names.at(-1)!;
  const parent = names.length > 1 ? singular(names.at(-2)!) : null;
  const one = (noun: string) => `${article(noun)} ${noun}`;

  if (isParam(last)) {
    const noun = singular(lastName);
    if (method === "GET") return `View ${one(noun)}`;
    if (method === "DELETE") return `Delete ${one(noun)}`;
    if (method === "PUT" || method === "PATCH") return `Update ${one(noun)}`;
  }
  const afterParam = parts.length >= 2 && isParam(parts.at(-2)!);
  // A singular word after an id is an action on that record: POST /projects/:id/upvote.
  if (afterParam && !lastName.endsWith("s") && parent) return `${capital(lastName)} ${one(parent)}`;
  if (method === "GET") {
    if (afterParam && parent) return `List ${one(parent)}’s ${lastName}`;
    return lastName.endsWith("s") ? `List ${lastName}` : `View the ${lastName}`;
  }
  if (method === "POST") return afterParam && parent ? `Add ${one(singular(lastName))} to ${one(parent)}` : `Create ${one(singular(lastName))}`;
  if (method === "DELETE") return `Delete ${lastName}`;
  return `${capital(method.toLowerCase())} ${lastName}`;
}
