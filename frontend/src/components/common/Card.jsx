const Card = ({ as: Tag = 'div', variant = 'default', className = '', children, ...rest }) => {
  const classes = ['vl-card', `vl-card--${variant}`, className].filter(Boolean).join(' ');
  return <Tag className={classes} {...rest}>{children}</Tag>;
};

export default Card;
