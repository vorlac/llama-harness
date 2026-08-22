; case compare-061-geint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  GE
  PRINT
  RET
.end
