import { useState, forwardRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../shared/Icon';

interface DocSectionCardProps {
  id: string;
  title: string;
  icon: string;
  iconColor?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export const DocSectionCard = forwardRef<HTMLElement, DocSectionCardProps>(
  function DocSectionCard({ id, title, icon, iconColor = 'var(--color-primary)', defaultOpen = true, children }, ref) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
      <section ref={ref} id={id} className="scroll-mt-6">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between py-3 group"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${iconColor}20`, color: iconColor }}
            >
              <Icon name={icon} size={18} />
            </div>
            <h2 className="text-base font-bold text-slate-100 font-display">{title}</h2>
          </div>
          <Icon
            name={isOpen ? 'expand_less' : 'expand_more'}
            size={20}
            className="text-slate-500 group-hover:text-slate-300 transition-colors"
          />
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pb-6">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    );
  }
);
