; case strops-039-indexof
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR "a"
  INDEXOF
  PRINT
  RET
.end
