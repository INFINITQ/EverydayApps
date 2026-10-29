// Works around a race in EmbedPDF 2.15's form plugin. Every keystroke in a form field starts
// its own multi-step write (read the field, set it, read it back, redraw), and writes that
// overlap can finish out of order, so fast typing lost its last characters ("Folio Test"
// instead of "Folio Tester"). Here writes run one at a time, and while one runs, only the
// newest value of each field waits its turn. Checked by e2e/pdf.spec.ts, which types fast.

import { Task, type PdfErrorReason, type PdfWidgetAnnoField, type PdfWidgetAnnoObject } from '@embedpdf/models';
import type { FormPlugin } from '@embedpdf/plugin-form/react';

type Write = (
  pageIndex: number,
  annotation: PdfWidgetAnnoObject,
  field: PdfWidgetAnnoField,
  documentId?: string,
) => Task<boolean, PdfErrorReason>;

type Job = { args: Parameters<Write>; tasks: Task<boolean, PdfErrorReason>[] };

const patched = new WeakSet<object>();

export function serializeFieldWrites(plugin: FormPlugin) {
  if (patched.has(plugin)) return;
  patched.add(plugin);
  // `setFormFieldValues` is private in EmbedPDF's types but an ordinary method; the plugin's
  // own capability calls it through `this`, so replacing it on the instance covers every caller.
  const target = plugin as unknown as { setFormFieldValues: Write };
  const write = target.setFormFieldValues.bind(plugin);
  const waiting = new Map<string, Job>();
  const order: string[] = [];
  let running = false;

  const next = () => {
    const key = order.shift();
    const job = key === undefined ? undefined : waiting.get(key);
    if (key === undefined || !job) {
      running = false;
      return;
    }
    waiting.delete(key);
    running = true;
    const finish = (settle: (task: Task<boolean, PdfErrorReason>) => void) => {
      for (const task of job.tasks) settle(task);
      next();
    };
    try {
      write(...job.args).wait(
        (ok) => finish((task) => task.resolve(ok)),
        (error) => finish((task) => task.fail(error)),
      );
    } catch (error) {
      finish((task) => task.reject({ code: 0, message: String(error) } as PdfErrorReason));
    }
  };

  target.setFormFieldValues = (...args) => {
    const [, annotation, , documentId] = args;
    const key = `${documentId ?? ''}\u0000${annotation.id}`;
    const task = new Task<boolean, PdfErrorReason>();
    const job = waiting.get(key);
    if (job) {
      job.args = args;
      job.tasks.push(task);
    } else {
      waiting.set(key, { args, tasks: [task] });
      order.push(key);
    }
    if (!running) next();
    return task;
  };
}
