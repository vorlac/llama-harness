; Output written before a trap must still reach stdout.
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_INT 1
  PUSH_INT 0
  DIV
  PRINT
  RET
.end
