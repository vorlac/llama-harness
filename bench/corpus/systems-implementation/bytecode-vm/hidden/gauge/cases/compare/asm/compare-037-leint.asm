; case compare-037-leint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  LE
  PRINT
  RET
.end
