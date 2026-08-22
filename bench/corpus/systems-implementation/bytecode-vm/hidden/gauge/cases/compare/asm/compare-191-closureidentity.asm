; case compare-191-closureidentity
; expect exit=0 stdout="true\nfalse\n"
.func main arity=0 locals=0
  CLOSURE helper
  DUP
  EQ
  PRINT
  CLOSURE helper
  CLOSURE helper
  EQ
  PRINT
  RET
.end
.func helper arity=0 locals=0
  PUSH_NIL
  RET
.end
