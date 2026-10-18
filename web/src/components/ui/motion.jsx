import { motion } from 'framer-motion'

// Shared motion primitives — editorial, expo-eased, staggered reveals in the house style.
export const EASE = [0.16, 1, 0.3, 1]

// Fade + rise when scrolled into view. Use `delay` or wrap in <Stagger> for sequencing.
export function Reveal({ children, delay = 0, y = 16, className, as = 'div', once = true, ...rest }) {
  const M = motion[as] || motion.div
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-10% 0px -10% 0px' }}
      transition={{ duration: 0.7, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </M>
  )
}

// Container that staggers its <Reveal>/motion children on enter.
export function Stagger({ children, className, gap = 0.06, once = true, ...rest }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: '-10% 0px' }}
      variants={{ show: { transition: { staggerChildren: gap } } }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

export const stagItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}

// Springy, tactile button wrapper (press + hover lift). Pass `as={Link}`/className through.
export function Tactile({ children, className, as, ...rest }) {
  const M = as ? motion(as) : motion.button
  return (
    <M
      className={className}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      {...rest}
    >
      {children}
    </M>
  )
}
